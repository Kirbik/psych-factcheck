-- Persist separate, explicitly subjective report commentary as a fenced workflow artifact.
create table public.analysis_report_narratives (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.analysis_jobs(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  generation integer not null check (generation > 0),
  provider text not null check (provider = 'openai'),
  model text not null check (length(model) between 1 and 200),
  narrative_version text not null check (length(narrative_version) between 1 and 100),
  prompt_version text not null check (length(prompt_version) between 1 and 100),
  schema_version text not null check (length(schema_version) between 1 and 100),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint analysis_report_narratives_job_generation_schema_key
    unique (job_id, generation, schema_version)
);

alter table public.analysis_report_narratives enable row level security;
revoke all on public.analysis_report_narratives from anon, authenticated, service_role;
grant select on public.analysis_report_narratives to authenticated, service_role;
create policy analysis_report_narratives_select_own
  on public.analysis_report_narratives for select to authenticated
  using (exists (
    select 1 from public.content_items ci
    where ci.id = analysis_report_narratives.content_item_id
      and ci.user_id = auth.uid()
  ));

create function public.save_analysis_report_narrative_for_run(
  p_job_id uuid,
  p_generation integer,
  p_run_id text,
  p_provider text,
  p_model text,
  p_narrative_version text,
  p_prompt_version text,
  p_schema_version text,
  p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  job public.analysis_jobs;
  narrative_id uuid;
  item jsonb;
  item_count integer := 0;
  expected_count integer;
begin
  select * into job from public.analysis_jobs
  where id = p_job_id and generation = p_generation and run_id = p_run_id
    and status = 'running' and stage = 'judge_claims'
  for update;
  if job.id is null then raise exception 'Analysis run is no longer current'; end if;

  if p_provider <> 'openai'
    or p_model is null or length(p_model) not between 1 and 200
    or p_narrative_version is null or length(p_narrative_version) not between 1 and 100
    or p_prompt_version is null or length(p_prompt_version) not between 1 and 100
    or p_schema_version is null or length(p_schema_version) not between 1 and 100
    or jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload -> 'claims') <> 'array'
    or coalesce(length(p_payload ->> 'overallConclusion'), 0) not between 1 and 1500
    or coalesce(length(p_payload ->> 'subjectiveOpinion'), 0) not between 1 and 1500 then
    raise exception 'Invalid report narrative';
  end if;

  select count(*) into expected_count
  from public.fact_checks fc
  join public.claims c on c.id = fc.claim_id
  join public.claim_extractions ce on ce.id = c.claim_extraction_id
  join public.transcripts t on t.id = ce.transcript_id
  where t.content_item_id = job.content_item_id
    and fc.judgment_version = 'fact-check-judgment-v4';

  for item in select value from jsonb_array_elements(p_payload -> 'claims') loop
    item_count := item_count + 1;
    if jsonb_typeof(item) <> 'object' then raise exception 'Invalid narrative claim'; end if;
    if (select count(*) from jsonb_object_keys(item)) <> 3
      or coalesce(length(item ->> 'commentary'), 0) not between 1 and 600
      or not exists (
        select 1 from public.fact_checks fc
        join public.claims c on c.id = fc.claim_id
        join public.claim_extractions ce on ce.id = c.claim_extraction_id
        join public.transcripts t on t.id = ce.transcript_id
        where fc.id = (item ->> 'factCheckId')::uuid
          and fc.claim_id = (item ->> 'claimId')::uuid
          and fc.judgment_version = 'fact-check-judgment-v4'
          and t.content_item_id = job.content_item_id
      ) then
      raise exception 'Narrative claim is not backed by a saved fact check';
    end if;
  end loop;
  if item_count <> expected_count
    or (select count(distinct value ->> 'claimId') from jsonb_array_elements(p_payload -> 'claims')) <> item_count
    or (select count(distinct value ->> 'factCheckId') from jsonb_array_elements(p_payload -> 'claims')) <> item_count then
    raise exception 'Narrative claim set is incomplete';
  end if;

  insert into public.analysis_report_narratives (
    job_id, content_item_id, generation, provider, model,
    narrative_version, prompt_version, schema_version, payload
  ) values (
    job.id, job.content_item_id, job.generation, p_provider, p_model,
    p_narrative_version, p_prompt_version, p_schema_version, p_payload
  ) on conflict (job_id, generation, schema_version) do nothing
  returning id into narrative_id;

  if narrative_id is null then
    select id into narrative_id from public.analysis_report_narratives
    where job_id = job.id and generation = job.generation and schema_version = p_schema_version;
  end if;
  return narrative_id;
end;
$$;

revoke all on function public.save_analysis_report_narrative_for_run(
  uuid, integer, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.save_analysis_report_narrative_for_run(
  uuid, integer, text, text, text, text, text, text, jsonb
) to service_role;

-- Session 7: version the analysis job for the persisted claim-extraction stage.
alter table public.analysis_jobs
  alter column pipeline_version set default 'claim-extraction-v1';

update public.analysis_jobs
set pipeline_version = 'claim-extraction-v1',
  status = case
    when status = 'completed' and error_code is distinct from 'VIDEO_OUT_OF_SCOPE'
      then 'queued'::public.analysis_job_status
    else status
  end,
  stage = case
    when status = 'completed' and error_code is distinct from 'VIDEO_OUT_OF_SCOPE'
      then 'queued'
    else stage
  end,
  run_id = case
    when status = 'completed' and error_code is distinct from 'VIDEO_OUT_OF_SCOPE'
      then null
    else run_id
  end,
  attempt = case
    when status = 'completed' and error_code is distinct from 'VIDEO_OUT_OF_SCOPE'
      then 0
    else attempt
  end,
  error_code = case
    when status = 'completed' and error_code is distinct from 'VIDEO_OUT_OF_SCOPE'
      then null
    else error_code
  end,
  started_at = case
    when status = 'completed' and error_code is distinct from 'VIDEO_OUT_OF_SCOPE'
      then null
    else started_at
  end,
  completed_at = case
    when status = 'completed' and error_code is distinct from 'VIDEO_OUT_OF_SCOPE'
      then null
    else completed_at
  end
where pipeline_version = 'transcription-v1';

alter table public.analysis_jobs
  drop constraint analysis_jobs_stage_check,
  add constraint analysis_jobs_stage_check check (stage in (
    'queued', 'validate_upload', 'screen_video', 'transcribe_video',
    'extract_claims', 'complete'
  ));

create or replace function public.request_analysis_job(
  p_content_item_id uuid,
  p_retry_generation integer default null
) returns public.analysis_jobs
language plpgsql security definer set search_path = '' as $$
declare job public.analysis_jobs;
begin
  perform 1 from public.content_items
    where id = p_content_item_id and user_id = auth.uid() and storage_path is not null
    for update;
  if not found then raise exception 'Content not found' using errcode = '42501'; end if;
  insert into public.analysis_jobs (content_item_id, user_id)
    values (p_content_item_id, auth.uid())
    on conflict (content_item_id, pipeline_version) do nothing;
  select * into job from public.analysis_jobs
    where content_item_id = p_content_item_id
      and pipeline_version = 'claim-extraction-v1' for update;
  if job.status in ('failed', 'cancelled') and job.generation = p_retry_generation then
    update public.analysis_jobs set status = 'queued', stage = 'queued',
      generation = generation + 1, run_id = null, attempt = 0, error_code = null,
      started_at = null, completed_at = null
      where id = job.id returning * into job;
  end if;
  return job;
end;
$$;

create or replace function public.set_analysis_job_stage(
  p_job_id uuid,
  p_generation integer,
  p_run_id text,
  p_stage text,
  p_attempt integer default 0
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_stage not in ('validate_upload', 'screen_video', 'transcribe_video', 'extract_claims') then
    raise exception 'Invalid analysis stage';
  end if;
  update public.analysis_jobs set
    stage = p_stage,
    attempt = greatest(attempt, p_attempt)
  where id = p_job_id and generation = p_generation and run_id = p_run_id
    and status = 'running';
  return found;
end;
$$;

create table public.claim_extractions (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.transcripts(id) on delete cascade,
  extraction_version text not null,
  provider text not null check (provider = 'openai'),
  model text not null check (length(model) > 0),
  instructions_version text not null,
  schema_version text not null,
  created_at timestamptz not null default now(),
  constraint claim_extractions_transcript_version_key unique (transcript_id, extraction_version)
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  claim_extraction_id uuid not null references public.claim_extractions(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  original_text text not null check (length(original_text) between 1 and 1200),
  normalized_text text not null check (length(normalized_text) between 1 and 1200),
  start_seconds double precision not null check (start_seconds >= 0),
  end_seconds double precision not null check (end_seconds >= start_seconds),
  claim_type text not null check (claim_type in (
    'descriptive_prevalence', 'causal_mechanistic', 'intervention',
    'diagnostic_classification', 'prognostic', 'consensus_theory', 'historical'
  )),
  created_at timestamptz not null default now(),
  constraint claims_extraction_ordinal_key unique (claim_extraction_id, ordinal)
);

alter table public.claim_extractions enable row level security;
alter table public.claims enable row level security;
revoke all on public.claim_extractions, public.claims from anon;
revoke insert, update, delete on public.claim_extractions, public.claims from authenticated;
grant select on public.claim_extractions, public.claims to authenticated, service_role;
grant insert on public.claim_extractions, public.claims to service_role;

create policy claim_extractions_select_own on public.claim_extractions
  for select to authenticated using (exists (
    select 1 from public.transcripts t
    join public.content_items c on c.id = t.content_item_id
    where t.id = claim_extractions.transcript_id and c.user_id = auth.uid()
  ));
create policy claims_select_own on public.claims
  for select to authenticated using (exists (
    select 1 from public.claim_extractions e
    join public.transcripts t on t.id = e.transcript_id
    join public.content_items c on c.id = t.content_item_id
    where e.id = claims.claim_extraction_id and c.user_id = auth.uid()
  ));

-- The extraction row is the idempotency marker, including when the model returns no claims.
create function public.save_claim_extraction(
  p_transcript_id uuid,
  p_extraction_version text,
  p_provider text,
  p_model text,
  p_instructions_version text,
  p_schema_version text,
  p_claims jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare extraction_id uuid;
begin
  if jsonb_typeof(p_claims) <> 'array' or jsonb_array_length(p_claims) > 100 then
    raise exception 'Invalid claim payload';
  end if;
  insert into public.claim_extractions (
    transcript_id, extraction_version, provider, model, instructions_version, schema_version
  ) values (
    p_transcript_id, p_extraction_version, p_provider, p_model,
    p_instructions_version, p_schema_version
  ) on conflict (transcript_id, extraction_version) do nothing
  returning id into extraction_id;

  if extraction_id is null then
    select id into extraction_id from public.claim_extractions
    where transcript_id = p_transcript_id and extraction_version = p_extraction_version;
    return extraction_id;
  end if;

  insert into public.claims (
    claim_extraction_id, ordinal, original_text, normalized_text,
    start_seconds, end_seconds, claim_type
  )
  select extraction_id, item.ordinality - 1,
    item.value ->> 'original', item.value ->> 'normalized',
    (item.value ->> 'startSeconds')::double precision,
    (item.value ->> 'endSeconds')::double precision,
    item.value ->> 'claimType'
  from jsonb_array_elements(p_claims) with ordinality as item(value, ordinality);
  return extraction_id;
end;
$$;
revoke all on function public.save_claim_extraction(uuid, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_claim_extraction(uuid, text, text, text, text, text, jsonb)
  to service_role;

-- Session 6: versioned OpenAI transcription and durable timestamped segments.
alter table public.analysis_jobs
  alter column pipeline_version set default 'transcription-v1';

alter table public.analysis_jobs
  drop constraint analysis_jobs_stage_check,
  add constraint analysis_jobs_stage_check
    check (stage in ('queued', 'validate_upload', 'transcribe_video', 'complete'));

create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  pipeline_version text not null default 'transcription-v1',
  provider text not null check (provider = 'openai'),
  model text not null check (length(model) > 0),
  language text,
  segments jsonb not null check (jsonb_typeof(segments) = 'array'),
  created_at timestamptz not null default now(),
  constraint transcripts_content_pipeline_key unique (content_item_id, pipeline_version)
);

alter table public.transcripts enable row level security;
revoke all on public.transcripts from anon;
revoke insert, update, delete on public.transcripts from authenticated;
grant select on public.transcripts to authenticated, service_role;
grant insert, update on public.transcripts to service_role;
create policy transcripts_select_own on public.transcripts
  for select to authenticated
  using (exists (
    select 1 from public.content_items c
    where c.id = transcripts.content_item_id and c.user_id = auth.uid()
  ));

-- New uploads and explicit requests use the transcription pipeline version.
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
    where content_item_id = p_content_item_id and pipeline_version = 'transcription-v1' for update;
  if job.status in ('failed', 'cancelled') and job.generation = p_retry_generation then
    update public.analysis_jobs set status = 'queued', stage = 'queued',
      generation = generation + 1, run_id = null, attempt = 0, error_code = null,
      started_at = null, completed_at = null
      where id = job.id returning * into job;
  end if;
  return job;
end;
$$;
revoke all on function public.request_analysis_job(uuid, integer) from public, anon;
grant execute on function public.request_analysis_job(uuid, integer) to authenticated;

create function public.set_analysis_job_stage(
  p_job_id uuid,
  p_generation integer,
  p_run_id text,
  p_stage text,
  p_attempt integer default 0
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_stage not in ('validate_upload', 'transcribe_video') then
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
revoke all on function public.set_analysis_job_stage(uuid, integer, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.set_analysis_job_stage(uuid, integer, text, text, integer)
  to service_role;

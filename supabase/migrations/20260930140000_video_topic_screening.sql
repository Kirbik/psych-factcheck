-- Persist only the bounded-screening decision metadata, never sampled transcript text.
create table public.video_screenings (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  screening_version text not null,
  provider text not null check (provider = 'openai'),
  sample_model text not null,
  classifier_model text not null,
  instructions_version text not null,
  decision text not null check (decision in ('relevant', 'unrelated', 'uncertain')),
  reason_code text not null check (reason_code in (
    'no_psychology_content', 'incidental_mention', 'no_checkable_claims',
    'psychology_claims_present', 'unclear_sample', 'sample_unavailable',
    'provider_error', 'invalid_model_output'
  )),
  confidence double precision not null check (confidence >= 0 and confidence <= 1),
  rationale text not null check (length(rationale) <= 240),
  sample_duration_seconds double precision not null check (
    sample_duration_seconds >= 0 and sample_duration_seconds <= 12
  ),
  created_at timestamptz not null default now(),
  constraint video_screenings_content_version_key unique (content_item_id, screening_version)
);

alter table public.video_screenings enable row level security;
revoke all on public.video_screenings from anon, authenticated;
grant select, insert, update on public.video_screenings to service_role;

alter table public.analysis_jobs
  drop constraint analysis_jobs_stage_check,
  add constraint analysis_jobs_stage_check
    check (stage in ('queued', 'validate_upload', 'screen_video', 'transcribe_video', 'complete'));

create or replace function public.set_analysis_job_stage(
  p_job_id uuid,
  p_generation integer,
  p_run_id text,
  p_stage text,
  p_attempt integer default 0
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_stage not in ('validate_upload', 'screen_video', 'transcribe_video') then
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

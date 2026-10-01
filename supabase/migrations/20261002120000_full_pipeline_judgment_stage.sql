-- Session 12: expose the persisted evidence-bound judgment stage.
alter table public.analysis_jobs
  drop constraint analysis_jobs_stage_check,
  add constraint analysis_jobs_stage_check check (stage in (
    'queued', 'validate_upload', 'screen_video', 'transcribe_video',
    'extract_claims', 'build_evidence', 'judge_claims', 'complete'
  ));

create or replace function public.set_analysis_job_stage(
  p_job_id uuid,
  p_generation integer,
  p_run_id text,
  p_stage text,
  p_attempt integer default 0
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_stage not in (
    'validate_upload', 'screen_video', 'transcribe_video',
    'extract_claims', 'build_evidence', 'judge_claims'
  ) then
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

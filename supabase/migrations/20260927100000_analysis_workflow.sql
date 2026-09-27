-- Session 5: one durable orchestration job per uploaded video/version.
alter table public.analysis_jobs
  add column pipeline_version text not null default 'orchestration-v1',
  add column generation integer not null default 1 check (generation > 0),
  add column stage text not null default 'queued' check (stage in ('queued', 'validate_upload', 'complete')),
  add column run_id text,
  add column attempt integer not null default 0 check (attempt >= 0),
  add column error_code text,
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add constraint analysis_jobs_content_version_key unique (content_item_id, pipeline_version);

create index analysis_jobs_active_idx on public.analysis_jobs (updated_at)
  where status in ('queued', 'running');

-- Durable outbox: navigation/HTTP shutdown cannot separate content persistence
-- from job creation. The scheduled dispatcher drains jobs even without an open UI.
create function app_private.queue_uploaded_video()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.storage_path is not null then
    insert into public.analysis_jobs (content_item_id, user_id)
      values (new.id, new.user_id)
      on conflict (content_item_id, pipeline_version) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app_private.queue_uploaded_video() from public, anon, authenticated;
create trigger queue_uploaded_video after insert on public.content_items
  for each row execute function app_private.queue_uploaded_video();

-- The caller never supplies an owner. Lock the content to serialize concurrent starts.
create function public.request_analysis_job(p_content_item_id uuid, p_retry_generation integer default null)
returns public.analysis_jobs language plpgsql security definer set search_path = '' as $$
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
    where content_item_id = p_content_item_id and pipeline_version = 'orchestration-v1' for update;
  -- A repeated retry request cannot reset a newer generation.
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

-- Only the worker can move lifecycle state. Generation/run fencing rejects stale workers.
create function public.advance_analysis_job(
  p_job_id uuid, p_generation integer, p_run_id text, p_status public.analysis_job_status,
  p_attempt integer default 0, p_error_code text default null
) returns setof public.analysis_jobs language plpgsql security definer set search_path = '' as $$
begin
  if p_run_id is null or length(p_run_id) = 0 then raise exception 'Run id required'; end if;
  return query update public.analysis_jobs set
    status = p_status,
    run_id = p_run_id,
    attempt = greatest(attempt, p_attempt),
    stage = case when p_status = 'completed' then 'complete' when p_status = 'running' then 'validate_upload' else stage end,
    error_code = p_error_code,
    started_at = case when p_status = 'running' then coalesce(started_at, now()) else started_at end,
    completed_at = case when p_status in ('completed', 'failed', 'cancelled') then now() else null end
  where id = p_job_id and generation = p_generation
    and (run_id is null or run_id = p_run_id)
    and (
      (status = 'queued' and p_status in ('queued', 'running', 'failed', 'cancelled')) or
      (status = 'running' and p_status in ('running', 'completed', 'failed', 'cancelled'))
    ) returning *;
end;
$$;
revoke all on function public.advance_analysis_job(uuid, integer, text, public.analysis_job_status, integer, text) from public, anon, authenticated;
grant execute on function public.advance_analysis_job(uuid, integer, text, public.analysis_job_status, integer, text) to service_role;
grant select on public.analysis_jobs, public.content_items to service_role;

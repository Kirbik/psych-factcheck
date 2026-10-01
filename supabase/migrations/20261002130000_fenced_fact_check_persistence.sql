-- Session 12: make immutable judgment persistence conditional on current run ownership.
create function public.save_fact_check_for_analysis_run(
  p_job_id uuid,
  p_generation integer,
  p_run_id text,
  p_claim_id uuid,
  p_evidence_package_id uuid,
  p_judgment_version text,
  p_provider text,
  p_model text,
  p_instructions_version text,
  p_schema_version text,
  p_judgment jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  owned_job_id uuid;
  package_claim jsonb;
  stored_claim jsonb;
begin
  select j.id into owned_job_id
  from public.analysis_jobs j
  join public.content_items ci on ci.id = j.content_item_id
  join public.transcripts t on t.content_item_id = ci.id
  join public.claim_extractions ce on ce.transcript_id = t.id
  join public.claims c on c.claim_extraction_id = ce.id
  where j.id = p_job_id and j.generation = p_generation and j.run_id = p_run_id
    and j.status = 'running' and j.stage = 'judge_claims'
    and c.id = p_claim_id
  for update of j;

  if owned_job_id is null then
    raise exception 'Analysis run is no longer current';
  end if;

  select ep.payload -> 'claim', jsonb_build_object(
    'original', c.original_text,
    'normalized', c.normalized_text,
    'startSeconds', c.start_seconds,
    'endSeconds', c.end_seconds,
    'claimType', c.claim_type
  ) into package_claim, stored_claim
  from public.evidence_packages ep
  join public.claims c on c.id = ep.claim_id
  where ep.id = p_evidence_package_id and ep.claim_id = p_claim_id;

  if package_claim is null or package_claim <> stored_claim then
    raise exception 'Evidence package claim mismatch';
  end if;

  return public.save_fact_check(
    p_claim_id, p_evidence_package_id, p_judgment_version, p_provider,
    p_model, p_instructions_version, p_schema_version, p_judgment
  );
end;
$$;

revoke all on function public.save_fact_check_for_analysis_run(
  uuid, integer, text, uuid, uuid, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.save_fact_check_for_analysis_run(
  uuid, integer, text, uuid, uuid, text, text, text, text, text, jsonb
) to service_role;

-- Keep the original integrity routine private behind the fenced entrypoint.
revoke execute on function public.save_fact_check(uuid, uuid, text, text, text, text, text, jsonb)
  from service_role;

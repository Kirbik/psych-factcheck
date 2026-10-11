-- Accept v7 prompt-only model assessments while preserving prior no-search judgments.
begin;

create or replace function public.save_fact_check(
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
  fact_check_id uuid;
  citation jsonb;
  citation_chunk_id uuid;
  citation_ordinal integer := 0;
  verdict_value text;
  package_item_count integer;
  package_retrieval_version text;
  is_assessment boolean := p_judgment_version in (
    'fact-check-judgment-v5', 'fact-check-judgment-v6', 'fact-check-judgment-v7'
  );
begin
  select payload ->> 'retrievalVersion' into package_retrieval_version
  from public.evidence_packages
  where id = p_evidence_package_id and claim_id = p_claim_id;

  if p_judgment is null or jsonb_typeof(p_judgment) <> 'object'
    or jsonb_typeof(p_judgment -> 'limitations') <> 'array'
    or jsonb_array_length(p_judgment -> 'limitations') > 8
    or exists (
      select 1 from jsonb_array_elements(p_judgment -> 'limitations') as limitation(value)
      where jsonb_typeof(limitation.value) <> 'string'
        or length(limitation.value #>> '{}') not between 1 and 500
    )
    or jsonb_typeof(p_judgment -> 'citations') <> 'array'
    or jsonb_array_length(p_judgment -> 'citations') > 5 then
    raise exception 'Invalid fact-check judgment';
  end if;

  verdict_value := p_judgment ->> 'verdict';
  if verdict_value not in (
    'SUPPORTED', 'MOSTLY_SUPPORTED', 'OVERSIMPLIFIED',
    'INSUFFICIENT_EVIDENCE', 'CONTRADICTED', 'UNVERIFIABLE'
  ) or p_provider <> 'openai'
    or p_judgment_version is null or length(p_judgment_version) not between 1 and 100
    or p_model is null or length(p_model) not between 1 and 200
    or p_instructions_version is null or length(p_instructions_version) not between 1 and 100
    or p_schema_version is null or length(p_schema_version) not between 1 and 100
    or (not is_assessment and ((p_judgment ->> 'confidence') is null or (p_judgment ->> 'confidence')::double precision not between 0 and 1))
    or (is_assessment and (
      p_judgment -> 'confidence' is distinct from 'null'::jsonb
      or jsonb_typeof(p_judgment -> 'assessment') is distinct from 'object'
      or p_judgment -> 'assessment' ->> 'claimType' is null
      or p_judgment -> 'assessment' ->> 'claimType' not in ('factual','causal','predictive','intervention_effect','practical_advice','normative','metaphor','unclear')
      or p_judgment -> 'assessment' ->> 'researchVerdict' is null
      or p_judgment -> 'assessment' ->> 'researchVerdict' not in ('supported','false','misleading','complicated','unsupported','unknown','not_empirical')
      or p_judgment -> 'assessment' ->> 'evidenceStrength' is null
      or p_judgment -> 'assessment' ->> 'evidenceStrength' not in ('high','moderate','low','very_low','insufficient','not_applicable')
      or p_judgment -> 'assessment' ->> 'confidence' is null
      or p_judgment -> 'assessment' ->> 'confidence' not in ('high','moderate','low')
      or jsonb_typeof(p_judgment -> 'assessment' -> 'caveats') is distinct from 'array'
      or jsonb_array_length(p_judgment -> 'assessment' -> 'caveats') > 6
      or p_judgment -> 'assessment' ->> 'shortConclusion' is null
      or length(p_judgment -> 'assessment' ->> 'shortConclusion') not between 1 and 600
      or p_judgment -> 'assessment' ->> 'reasoning' is null
      or length(p_judgment -> 'assessment' ->> 'reasoning') not between 1 and 1700
      or p_judgment -> 'assessment' ->> 'neededForAssessment' is null
      or length(p_judgment -> 'assessment' ->> 'neededForAssessment') not between 1 and 350
      or (p_judgment_version = 'fact-check-judgment-v7'
        and (p_judgment -> 'assessment' ->> 'modelVerdict' is null
          or p_judgment -> 'assessment' ->> 'modelVerdict' not in ('plausible','questionable','overgeneralized','not_assessable','not_empirical')))
      or (package_retrieval_version = 'psychology-skill-no-search-v1'
        and (
          p_judgment -> 'assessment' ->> 'researchVerdict' not in ('unknown','not_empirical')
          or (p_judgment -> 'assessment' ->> 'researchVerdict' = 'unknown'
            and (p_judgment -> 'assessment' ->> 'evidenceStrength' <> 'insufficient'
              or p_judgment -> 'assessment' ->> 'confidence' <> 'low'))
          or (p_judgment -> 'assessment' ->> 'researchVerdict' = 'not_empirical'
            and p_judgment -> 'assessment' ->> 'evidenceStrength' <> 'not_applicable')
        ))
    ))
    or length(p_judgment ->> 'explanation') not between 1 and 4000 then
    raise exception 'Invalid fact-check judgment fields';
  end if;

  select count(*) into package_item_count
  from public.evidence_package_items
  where evidence_package_id = p_evidence_package_id;
  if package_item_count = 0 and verdict_value not in ('INSUFFICIENT_EVIDENCE', 'UNVERIFIABLE') then
    raise exception 'Verdict requires evidence';
  end if;
  if verdict_value in ('SUPPORTED', 'MOSTLY_SUPPORTED', 'OVERSIMPLIFIED', 'CONTRADICTED')
    and jsonb_array_length(p_judgment -> 'citations') = 0 then
    raise exception 'Evidence-based verdict requires a citation';
  end if;

  if jsonb_array_length(p_judgment -> 'citations') <> (
    select count(distinct citation.value ->> 'chunkId')
    from jsonb_array_elements(p_judgment -> 'citations') as citation(value)
  ) then
    raise exception 'Duplicate fact-check citation';
  end if;
  for citation in
    select value from jsonb_array_elements(p_judgment -> 'citations')
  loop
    if jsonb_typeof(citation) <> 'object'
      or citation ->> 'relation' not in ('supports', 'qualifies', 'contradicts')
      or length(citation ->> 'rationale') not between 1 and 600 then
      raise exception 'Invalid fact-check citation';
    end if;
    begin
      citation_chunk_id := (citation ->> 'chunkId')::uuid;
    exception when others then
      raise exception 'Invalid fact-check citation ID';
    end;
    if not exists (
      select 1 from public.evidence_package_items epi
      where epi.evidence_package_id = p_evidence_package_id
        and epi.evidence_chunk_id = citation_chunk_id
    ) then
      raise exception 'Citation is outside evidence package';
    end if;
  end loop;

  if is_assessment and (
    (p_judgment -> 'assessment' ->> 'researchVerdict' = 'false' and not exists (
      select 1 from jsonb_array_elements(p_judgment -> 'citations') item
      where item.value ->> 'relation' = 'contradicts'
    )) or
    (p_judgment -> 'assessment' ->> 'researchVerdict' = 'supported' and not exists (
      select 1 from jsonb_array_elements(p_judgment -> 'citations') item
      where item.value ->> 'relation' = 'supports'
    )) or
    (p_judgment -> 'assessment' ->> 'researchVerdict' = 'misleading' and not exists (
      select 1 from jsonb_array_elements(p_judgment -> 'citations') item
      where item.value ->> 'relation' in ('qualifies','contradicts')
    ))
  ) then
    raise exception 'Psychology assessment requires a matching evidence citation';
  end if;

  insert into public.fact_checks (
    claim_id, evidence_package_id, judgment_version, provider, model,
    instructions_version, schema_version, verdict, confidence, assessment, explanation, limitations
  ) values (
    p_claim_id, p_evidence_package_id, p_judgment_version, p_provider, p_model,
    p_instructions_version, p_schema_version, verdict_value,
    case when is_assessment then null else (p_judgment ->> 'confidence')::double precision end,
    case when is_assessment then p_judgment -> 'assessment' else null end,
    p_judgment ->> 'explanation', p_judgment -> 'limitations'
  ) on conflict (claim_id, evidence_package_id, judgment_version) do nothing
  returning id into fact_check_id;

  if fact_check_id is null then
    select id into fact_check_id from public.fact_checks
    where claim_id = p_claim_id and evidence_package_id = p_evidence_package_id
      and judgment_version = p_judgment_version;
    return fact_check_id;
  end if;

  for citation in
    select value from jsonb_array_elements(p_judgment -> 'citations')
  loop
    citation_chunk_id := (citation ->> 'chunkId')::uuid;
    insert into public.fact_check_evidence (
      fact_check_id, evidence_package_id, evidence_chunk_id, ordinal, relation, rationale
    ) values (
      fact_check_id, p_evidence_package_id, citation_chunk_id, citation_ordinal,
      citation ->> 'relation', citation ->> 'rationale'
    );
    citation_ordinal := citation_ordinal + 1;
  end loop;

  return fact_check_id;
end;
$$;

commit;


-- Keep report narrative persistence aligned with the active v6 judgment pipeline.
create or replace function public.save_analysis_report_narrative_for_run(
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
    and fc.judgment_version = 'fact-check-judgment-v7';

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
          and fc.judgment_version = 'fact-check-judgment-v7'
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

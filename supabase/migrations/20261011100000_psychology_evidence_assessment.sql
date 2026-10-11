-- Persist the psychology evidence-check assessment alongside legacy verdicts.
begin;
alter table public.fact_checks alter column confidence drop not null;
alter table public.fact_checks add column assessment jsonb null
  check (assessment is null or jsonb_typeof(assessment) = 'object');

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
  is_current boolean := p_judgment_version = 'fact-check-judgment-v5';
begin
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
    or (not is_current and ((p_judgment ->> 'confidence') is null or (p_judgment ->> 'confidence')::double precision not between 0 and 1))
    or (is_current and (
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

  if is_current and (
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
    case when is_current then null else (p_judgment ->> 'confidence')::double precision end,
    case when is_current then p_judgment -> 'assessment' else null end,
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

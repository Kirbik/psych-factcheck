-- Retire shared RAG storage while preserving saved results and citation attribution.
-- Maintenance rollout: pause intake/dispatch, drain active runs, back up the catalog,
-- apply migration and deploy compatible code together, then resume analysis.
begin;
lock table public.evidence_packages, public.evidence_package_items, public.fact_checks, public.fact_check_evidence in share row exclusive mode;
alter table public.evidence_package_items add column legacy_provenance jsonb not null default '{}'::jsonb
  check (jsonb_typeof(legacy_provenance) = 'object');
update public.evidence_package_items epi
set snapshot=jsonb_set(epi.snapshot,'{source}',(epi.snapshot->'source') ||
  jsonb_build_object('publisher',s.publisher,'doi',s.doi,'licenseCode',s.license_code,'licenseUrl',s.license_url)),
    legacy_provenance=jsonb_build_object('source',s.provenance,'excerpt',ec.provenance)
from public.evidence_chunks ec join public.sources s on s.id=ec.source_id
where epi.evidence_chunk_id=ec.id;
alter table public.evidence_package_items drop constraint evidence_package_items_evidence_chunk_id_fkey;
alter table public.fact_check_evidence drop constraint fact_check_evidence_evidence_chunk_id_fkey, add column evidence_package_id uuid;
update public.fact_check_evidence citation set evidence_package_id=fc.evidence_package_id from public.fact_checks fc where fc.id=citation.fact_check_id;
alter table public.fact_check_evidence alter column evidence_package_id set not null;
alter table public.fact_checks add constraint fact_checks_id_package_key unique(id,evidence_package_id);
alter table public.fact_check_evidence
 add constraint fact_check_evidence_check_package_fkey foreign key(fact_check_id,evidence_package_id) references public.fact_checks(id,evidence_package_id) on delete cascade,
 add constraint fact_check_evidence_package_item_fkey foreign key(evidence_package_id,evidence_chunk_id) references public.evidence_package_items(evidence_package_id,evidence_chunk_id) on delete cascade;
comment on column public.evidence_package_items.evidence_chunk_id is 'Stable package snapshot ID, not a shared catalog row';
drop function if exists public.match_evidence_chunks_v1(text,text,text,text,text[],date,date,integer);
drop function public.import_evidence_seed(jsonb,jsonb);
drop table if exists public.evidence_embeddings, public.claim_embeddings;
drop table public.evidence_chunks;
drop table public.sources;

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
    or (p_judgment ->> 'confidence')::double precision not between 0 and 1
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

  insert into public.fact_checks (
    claim_id, evidence_package_id, judgment_version, provider, model,
    instructions_version, schema_version, verdict, confidence, explanation, limitations
  ) values (
    p_claim_id, p_evidence_package_id, p_judgment_version, p_provider, p_model,
    p_instructions_version, p_schema_version, verdict_value,
    (p_judgment ->> 'confidence')::double precision,
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
create or replace function public.save_evidence_packages(
  p_claim_extraction_id uuid,
  p_retrieval_version text,
  p_reranking_version text,
  p_packages jsonb
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  package jsonb;
  evidence_item jsonb;
  package_id uuid;
  v_claim_id uuid;
  inserted_count integer := 0;
begin
  if p_packages is null or jsonb_typeof(p_packages) <> 'array'
    or jsonb_array_length(p_packages) > 100 then
    raise exception 'Invalid evidence packages payload';
  end if;

  for package in select value from jsonb_array_elements(p_packages) loop
    begin
      v_claim_id := (package ->> 'claimId')::uuid;
    exception when others then
      raise exception 'Invalid evidence package claim ID';
    end;

    if not exists (
      select 1 from public.claims c
      where c.id = v_claim_id and c.claim_extraction_id = p_claim_extraction_id
    ) then
      raise exception 'Evidence package claim is outside extraction';
    end if;
    if package ->> 'retrievalVersion' is distinct from p_retrieval_version
      or package ->> 'rerankingVersion' is distinct from p_reranking_version
      or package ->> 'coverage' not in ('none', 'limited', 'multi_source')
      or jsonb_typeof(package -> 'payload') <> 'object'
      or jsonb_typeof(package -> 'payload' -> 'evidence') <> 'array'
      or jsonb_array_length(package -> 'payload' -> 'evidence') > 5
      or jsonb_typeof(package -> 'payload' -> 'warnings') <> 'array'
      or jsonb_typeof(package -> 'payload' -> 'trace') <> 'object' then
      raise exception 'Invalid evidence package fields';
    end if;

    if p_retrieval_version = 'publication-search-v1'
      and package -> 'payload' ->> 'schemaVersion' is distinct from 'evidence-package-v2' then
      raise exception 'Invalid publication package schema';
    end if;

    insert into public.evidence_packages (
      claim_id, retrieval_version, reranking_version, coverage, warnings, trace, payload
    ) values (
      v_claim_id,
      p_retrieval_version,
      p_reranking_version,
      package ->> 'coverage',
      package -> 'payload' -> 'warnings',
      package -> 'payload' -> 'trace',
      package -> 'payload'
    ) on conflict (claim_id, retrieval_version, reranking_version) do nothing
    returning id into package_id;

    if package_id is null then
      continue;
    end if;
    inserted_count := inserted_count + 1;

    for evidence_item in
      select value from jsonb_array_elements(package -> 'payload' -> 'evidence')
    loop
      if jsonb_typeof(evidence_item) <> 'object'
        or (evidence_item ->> 'chunkId') is null
        or (evidence_item ->> 'retrievalScore') is null
        or (evidence_item ->> 'relevanceScore') is null then
        raise exception 'Invalid evidence package item';
      end if;

      if p_retrieval_version = 'publication-search-v1' and (
        package -> 'payload' ->> 'schemaVersion' is distinct from 'evidence-package-v2'
        or evidence_item -> 'attribution' ->> 'dataProvider' is distinct from 'europe-pmc'
        or evidence_item -> 'attribution' ->> 'availability' is distinct from 'open_access_full_text'
        or evidence_item -> 'attribution' ->> 'licenseCode' is distinct from 'CC-BY-4.0'
        or evidence_item -> 'attribution' ->> 'licenseUrl' is distinct from 'https://creativecommons.org/licenses/by/4.0/'
        or evidence_item ->> 'text' is null
        or length(evidence_item ->> 'text') not between 40 and 1000
        or evidence_item -> 'source' ->> 'licenseCode' is distinct from 'CC-BY-4.0'
        or evidence_item -> 'source' ->> 'licenseUrl' is distinct from 'https://creativecommons.org/licenses/by/4.0/'
      ) then raise exception 'Publication evidence is not licensed for audit retention'; end if;
      insert into public.evidence_package_items (
        evidence_package_id, evidence_chunk_id, ordinal,
        retrieval_score, relevance_score, snapshot
      ) values (
        package_id,
        (evidence_item ->> 'chunkId')::uuid,
        (select count(*)::integer from public.evidence_package_items existing
          where existing.evidence_package_id = package_id),
        (evidence_item ->> 'retrievalScore')::double precision,
        (evidence_item ->> 'relevanceScore')::double precision,
        evidence_item
      );
    end loop;
  end loop;
  return inserted_count;
end;
$$;
commit;

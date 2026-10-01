-- Session 11: persist immutable evidence-bound judgments and their citations.
alter table public.evidence_packages
  add constraint evidence_packages_id_claim_key unique (id, claim_id);

create table public.fact_checks (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null,
  evidence_package_id uuid not null,
  judgment_version text not null check (length(judgment_version) between 1 and 100),
  provider text not null check (provider = 'openai'),
  model text not null check (length(model) between 1 and 200),
  instructions_version text not null check (length(instructions_version) between 1 and 100),
  schema_version text not null check (length(schema_version) between 1 and 100),
  verdict text not null check (verdict in (
    'SUPPORTED', 'MOSTLY_SUPPORTED', 'OVERSIMPLIFIED',
    'INSUFFICIENT_EVIDENCE', 'CONTRADICTED', 'UNVERIFIABLE'
  )),
  confidence double precision not null check (confidence between 0 and 1),
  explanation text not null check (length(explanation) between 1 and 4000),
  limitations jsonb not null check (
    jsonb_typeof(limitations) = 'array' and jsonb_array_length(limitations) <= 8
  ),
  created_at timestamptz not null default now(),
  constraint fact_checks_package_claim_fkey
    foreign key (evidence_package_id, claim_id)
    references public.evidence_packages (id, claim_id) on delete cascade,
  constraint fact_checks_claim_package_version_key
    unique (claim_id, evidence_package_id, judgment_version)
);

create table public.fact_check_evidence (
  fact_check_id uuid not null references public.fact_checks(id) on delete cascade,
  evidence_chunk_id uuid not null references public.evidence_chunks(id) on delete restrict,
  ordinal integer not null check (ordinal between 0 and 4),
  relation text not null check (relation in ('supports', 'qualifies', 'contradicts')),
  rationale text not null check (length(rationale) between 1 and 600),
  primary key (fact_check_id, ordinal),
  constraint fact_check_evidence_chunk_key unique (fact_check_id, evidence_chunk_id)
);

create index fact_checks_claim_idx on public.fact_checks (claim_id, created_at desc);
create index fact_checks_package_idx on public.fact_checks (evidence_package_id);
create index fact_check_evidence_chunk_idx
  on public.fact_check_evidence (evidence_chunk_id);

alter table public.fact_checks enable row level security;
alter table public.fact_check_evidence enable row level security;
revoke all on public.fact_checks, public.fact_check_evidence from anon;
revoke insert, update, delete on public.fact_checks, public.fact_check_evidence
  from authenticated, service_role;
grant select on public.fact_checks, public.fact_check_evidence
  to authenticated, service_role;

create policy fact_checks_select_own on public.fact_checks
  for select to authenticated using (exists (
    select 1 from public.claims c
    join public.claim_extractions ce on ce.id = c.claim_extraction_id
    join public.transcripts t on t.id = ce.transcript_id
    join public.content_items ci on ci.id = t.content_item_id
    where c.id = fact_checks.claim_id and ci.user_id = auth.uid()
  ));
create policy fact_check_evidence_select_own on public.fact_check_evidence
  for select to authenticated using (exists (
    select 1 from public.fact_checks fc
    join public.claims c on c.id = fc.claim_id
    join public.claim_extractions ce on ce.id = c.claim_extraction_id
    join public.transcripts t on t.id = ce.transcript_id
    join public.content_items ci on ci.id = t.content_item_id
    where fc.id = fact_check_evidence.fact_check_id and ci.user_id = auth.uid()
  ));

create function public.save_fact_check(
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
      fact_check_id, evidence_chunk_id, ordinal, relation, rationale
    ) values (
      fact_check_id, citation_chunk_id, citation_ordinal,
      citation ->> 'relation', citation ->> 'rationale'
    );
    citation_ordinal := citation_ordinal + 1;
  end loop;

  return fact_check_id;
end;
$$;

revoke all on function public.save_fact_check(uuid, uuid, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_fact_check(uuid, uuid, text, text, text, text, text, jsonb)
  to service_role;

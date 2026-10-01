-- Session 10 workflow integration: persist immutable, owner-readable packages.
alter table public.analysis_jobs
  drop constraint analysis_jobs_stage_check,
  add constraint analysis_jobs_stage_check check (stage in (
    'queued', 'validate_upload', 'screen_video', 'transcribe_video',
    'extract_claims', 'build_evidence', 'complete'
  ));

create table public.evidence_packages (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  retrieval_version text not null check (length(retrieval_version) between 1 and 100),
  reranking_version text not null check (length(reranking_version) between 1 and 100),
  coverage text not null check (coverage in ('none', 'limited', 'multi_source')),
  warnings jsonb not null check (jsonb_typeof(warnings) = 'array'),
  trace jsonb not null check (jsonb_typeof(trace) = 'object'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint evidence_packages_claim_version_key
    unique (claim_id, retrieval_version, reranking_version)
);

create table public.evidence_package_items (
  evidence_package_id uuid not null references public.evidence_packages(id) on delete cascade,
  evidence_chunk_id uuid not null references public.evidence_chunks(id) on delete restrict,
  ordinal integer not null check (ordinal between 0 and 4),
  retrieval_score double precision not null check (retrieval_score between -1 and 1),
  relevance_score double precision not null check (relevance_score between 0 and 1),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  primary key (evidence_package_id, ordinal),
  constraint evidence_package_items_chunk_key unique (evidence_package_id, evidence_chunk_id),
  constraint evidence_package_items_snapshot_chunk_check
    check (snapshot ->> 'chunkId' = evidence_chunk_id::text)
);

create index evidence_packages_claim_idx on public.evidence_packages (claim_id, created_at desc);
create index evidence_package_items_chunk_idx on public.evidence_package_items (evidence_chunk_id);

alter table public.evidence_packages enable row level security;
alter table public.evidence_package_items enable row level security;
revoke all on public.evidence_packages, public.evidence_package_items from anon;
revoke insert, update, delete on public.evidence_packages, public.evidence_package_items from authenticated;
grant select on public.evidence_packages, public.evidence_package_items to authenticated, service_role;

create policy evidence_packages_select_own on public.evidence_packages
  for select to authenticated using (exists (
    select 1 from public.claims c
    join public.claim_extractions ce on ce.id = c.claim_extraction_id
    join public.transcripts t on t.id = ce.transcript_id
    join public.content_items ci on ci.id = t.content_item_id
    where c.id = evidence_packages.claim_id and ci.user_id = auth.uid()
  ));
create policy evidence_package_items_select_own on public.evidence_package_items
  for select to authenticated using (exists (
    select 1 from public.evidence_packages ep
    join public.claims c on c.id = ep.claim_id
    join public.claim_extractions ce on ce.id = c.claim_extraction_id
    join public.transcripts t on t.id = ce.transcript_id
    join public.content_items ci on ci.id = t.content_item_id
    where ep.id = evidence_package_items.evidence_package_id
      and ci.user_id = auth.uid()
  ));

create function public.save_evidence_packages(
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

revoke all on function public.save_evidence_packages(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_evidence_packages(uuid, text, text, jsonb)
  to service_role;

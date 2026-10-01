-- Session 8: shared, traceable source catalog and immutable evidence passages.
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique check (length(source_key) between 1 and 160),
  title text not null check (length(title) between 1 and 1000),
  authors text[] not null check (cardinality(authors) > 0),
  journal text not null check (length(journal) between 1 and 300),
  publisher text not null check (length(publisher) between 1 and 200),
  published_at date not null,
  doi text,
  canonical_url text not null check (canonical_url ~ '^https://'),
  source_type text not null check (source_type in ('journal_article', 'systematic_review', 'meta_analysis', 'commentary')),
  status text not null default 'active' check (status in ('active', 'corrected', 'retracted', 'withdrawn')),
  license_code text not null check (license_code in ('CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-NC-4.0')),
  license_url text not null check (license_url ~ '^https://creativecommons.org/licenses/'),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sources_doi_key unique (doi)
);

create table public.evidence_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  chunk_key text not null check (length(chunk_key) between 1 and 160),
  content text not null check (length(content) between 40 and 4000),
  locator text not null check (length(locator) between 1 and 500),
  language text not null check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evidence_chunks_source_chunk_key unique (source_id, chunk_key)
);

create index evidence_chunks_source_id_idx on public.evidence_chunks(source_id);
create index sources_status_published_at_idx on public.sources(status, published_at desc);

create trigger sources_set_updated_at before update on public.sources
  for each row execute function public.set_updated_at();
create trigger evidence_chunks_set_updated_at before update on public.evidence_chunks
  for each row execute function public.set_updated_at();

alter table public.sources enable row level security;
alter table public.evidence_chunks enable row level security;
revoke all on public.sources, public.evidence_chunks from anon;
revoke insert, update, delete on public.sources, public.evidence_chunks from authenticated;
grant select on public.sources, public.evidence_chunks to authenticated, service_role;
grant insert, update on public.sources, public.evidence_chunks to service_role;

create policy sources_read_catalog on public.sources
  for select to authenticated using (true);
create policy evidence_chunks_read_catalog on public.evidence_chunks
  for select to authenticated using (true);

-- One transaction makes each validated catalog import all-or-nothing and repeatable.
create function public.import_evidence_seed(p_sources jsonb, p_chunks jsonb)
returns table(source_count integer, chunk_count integer)
language plpgsql security definer set search_path = '' as $$
declare imported_sources integer; imported_chunks integer; expected_chunks integer;
begin
  if p_sources is null or jsonb_typeof(p_sources) is distinct from 'array'
    or jsonb_array_length(p_sources) not between 1 and 100 then
    raise exception 'Invalid evidence source payload';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) is distinct from 'array'
    or jsonb_array_length(p_chunks) not between 1 and 1000 then
    raise exception 'Invalid evidence chunk payload';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_chunks) as x(content text, content_sha256 text)
    where content is null or content_sha256 is distinct from
      encode(sha256(convert_to(content, 'UTF8')), 'hex')
  ) then raise exception 'Evidence chunk content hash mismatch'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_sources) as x(source_key text)
    group by source_key having count(*) > 1
  ) then raise exception 'Duplicate source key in evidence payload'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_chunks) as x(source_key text, chunk_key text)
    group by source_key, chunk_key having count(*) > 1
  ) then raise exception 'Duplicate evidence chunk key in payload'; end if;

  insert into public.sources (
    source_key, title, authors, journal, publisher, published_at, doi, canonical_url,
    source_type, status, license_code, license_url, provenance
  )
  select source_key, title, authors, journal, publisher, published_at, doi, canonical_url,
    source_type, status, license_code, license_url, provenance
  from jsonb_to_recordset(p_sources) as s(
    source_key text, title text, authors text[], journal text, publisher text,
    published_at date, doi text, canonical_url text, source_type text, status text,
    license_code text, license_url text, provenance jsonb
  )
  on conflict (source_key) do update set
    title = excluded.title, authors = excluded.authors, journal = excluded.journal,
    publisher = excluded.publisher, published_at = excluded.published_at,
    doi = excluded.doi, canonical_url = excluded.canonical_url,
    source_type = excluded.source_type,
    status = case when public.sources.status = 'active' then excluded.status else public.sources.status end,
    license_code = excluded.license_code, license_url = excluded.license_url,
    provenance = excluded.provenance;
  get diagnostics imported_sources = row_count;

  select jsonb_array_length(p_chunks) into expected_chunks;
  insert into public.evidence_chunks (
    source_id, chunk_key, content, locator, language, content_sha256, provenance
  )
  select s.id, c.chunk_key, c.content, c.locator, c.language, c.content_sha256, c.provenance
  from jsonb_to_recordset(p_chunks) as c(
    source_key text, chunk_key text, content text, locator text, language text,
    content_sha256 text, provenance jsonb
  )
  join public.sources s on s.source_key = c.source_key
  on conflict (source_id, chunk_key) do update set
    content = excluded.content, locator = excluded.locator, language = excluded.language,
    content_sha256 = excluded.content_sha256, provenance = excluded.provenance;
  get diagnostics imported_chunks = row_count;
  if imported_chunks <> expected_chunks then
    raise exception 'Evidence chunk references an unknown source';
  end if;
  return query select imported_sources, imported_chunks;
end;
$$;
revoke all on function public.import_evidence_seed(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_evidence_seed(jsonb, jsonb) to service_role;

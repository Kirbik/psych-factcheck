-- Allow bibliographic records for Russian scholarship and expert books.
-- Sources without a reusable text license remain metadata-only and receive no chunks.
alter table public.sources drop constraint sources_source_type_check;
alter table public.sources add constraint sources_source_type_check
  check (source_type in (
    'journal_article', 'systematic_review', 'meta_analysis', 'commentary',
    'book', 'textbook', 'monograph'
  ));

alter table public.sources drop constraint sources_license_code_check;
alter table public.sources add constraint sources_license_code_check
  check (license_code in (
    'CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-NC-4.0', 'ALL-RIGHTS-RESERVED'
  ));

alter table public.sources drop constraint sources_license_url_check;
alter table public.sources alter column license_url drop not null;
alter table public.sources add constraint sources_license_url_check
  check (license_url is null or license_url ~ '^https://');
alter table public.sources add constraint sources_license_reuse_consistency_check
  check (
    (license_code = 'ALL-RIGHTS-RESERVED' and license_url is null)
    or (license_code = 'CC-BY-4.0' and license_url = 'https://creativecommons.org/licenses/by/4.0/')
    or (license_code = 'CC-BY-3.0' and license_url = 'https://creativecommons.org/licenses/by/3.0/')
    or (license_code = 'CC-BY-NC-4.0' and license_url = 'https://creativecommons.org/licenses/by-nc/4.0/')
  );

create or replace function public.import_evidence_seed(p_sources jsonb, p_chunks jsonb)
returns table(source_count integer, chunk_count integer)
language plpgsql security definer set search_path = '' as $$
declare imported_sources integer; imported_chunks integer; expected_chunks integer;
begin
  if p_sources is null or jsonb_typeof(p_sources) is distinct from 'array'
    or jsonb_array_length(p_sources) not between 1 and 100 then
    raise exception 'Invalid evidence source payload';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) is distinct from 'array'
    or jsonb_array_length(p_chunks) not between 0 and 1000 then
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

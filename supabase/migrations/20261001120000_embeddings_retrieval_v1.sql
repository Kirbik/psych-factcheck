-- Session 9: versioned embeddings and provenance-preserving vector search.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table public.evidence_embeddings (
  evidence_chunk_id uuid not null references public.evidence_chunks(id) on delete cascade,
  provider text not null check (provider = 'openai'),
  model text not null check (model = 'text-embedding-3-small'),
  embedding_version text not null check (embedding_version = 'openai-text-embedding-3-small-1536-v1'),
  dimensions smallint not null check (dimensions = 1536),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  primary key (evidence_chunk_id, embedding_version)
);

create index evidence_embeddings_hnsw_cosine_idx
  on public.evidence_embeddings using hnsw (embedding extensions.vector_cosine_ops);

create table public.claim_embeddings (
  claim_id uuid not null references public.claims(id) on delete cascade,
  provider text not null check (provider = 'openai'),
  model text not null check (model = 'text-embedding-3-small'),
  embedding_version text not null check (embedding_version = 'openai-text-embedding-3-small-1536-v1'),
  dimensions smallint not null check (dimensions = 1536),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  primary key (claim_id, embedding_version)
);

alter table public.evidence_embeddings enable row level security;
alter table public.claim_embeddings enable row level security;
revoke all on public.evidence_embeddings, public.claim_embeddings from anon, authenticated;
grant all on public.evidence_embeddings, public.claim_embeddings to service_role;

create function public.match_evidence_chunks_v1(
  p_query_embedding text,
  p_embedding_model text,
  p_embedding_version text,
  p_language text default null,
  p_source_types text[] default null,
  p_published_after date default null,
  p_published_before date default null,
  p_match_count integer default 10
)
returns table (
  chunk_id uuid,
  source_id uuid,
  chunk_key text,
  content text,
  language text,
  locator text,
  source_key text,
  title text,
  authors text[],
  journal text,
  published_at date,
  source_type text,
  canonical_url text,
  similarity double precision
)
language plpgsql
security definer
set search_path = ''
as $$
declare query_vector extensions.vector(1536);
begin
  if p_embedding_model is distinct from 'text-embedding-3-small'
    or p_embedding_version is distinct from 'openai-text-embedding-3-small-1536-v1' then
    raise exception 'Unsupported embedding model or version';
  end if;
  if p_match_count is null or p_match_count not between 1 and 100 then
    raise exception 'Invalid evidence match count';
  end if;
  if p_language is not null and p_language !~ '^[a-z]{2}(-[A-Z]{2})?$' then
    raise exception 'Invalid evidence language filter';
  end if;
  query_vector := p_query_embedding::extensions.vector(1536);
  perform set_config('hnsw.iterative_scan', 'strict_order', true);

  return query
  select
    c.id,
    s.id,
    c.chunk_key,
    c.content,
    c.language,
    c.locator,
    s.source_key,
    s.title,
    s.authors,
    s.journal,
    s.published_at,
    s.source_type,
    s.canonical_url,
    1 - (ee.embedding OPERATOR(extensions.<=>) query_vector)
  from public.evidence_embeddings ee
  join public.evidence_chunks c on c.id = ee.evidence_chunk_id
  join public.sources s on s.id = c.source_id
  where ee.provider = 'openai'
    and ee.model = p_embedding_model
    and ee.embedding_version = p_embedding_version
    and ee.dimensions = 1536
    and ee.content_sha256 = c.content_sha256
    and s.status = 'active'
    and (p_language is null or c.language = p_language)
    and (p_source_types is null or s.source_type = any(p_source_types))
    and (p_published_after is null or s.published_at >= p_published_after)
    and (p_published_before is null or s.published_at <= p_published_before)
  order by ee.embedding OPERATOR(extensions.<=>) query_vector
  limit p_match_count;
end;
$$;

revoke all on function public.match_evidence_chunks_v1(text, text, text, text, text[], date, date, integer) from public, anon, authenticated;
grant execute on function public.match_evidence_chunks_v1(text, text, text, text, text[], date, date, integer) to service_role;

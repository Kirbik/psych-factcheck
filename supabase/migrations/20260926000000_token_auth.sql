-- Maps a one-time-issued token digest to a Supabase Auth identity.
-- The raw token is never stored in PostgreSQL; Auth stores it as a password hash.
create table public.auth_access_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token_hash text not null unique
    check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz
);

alter table public.auth_access_tokens enable row level security;

revoke all on table public.auth_access_tokens from anon, authenticated;
grant select, insert, update, delete on table public.auth_access_tokens to service_role;

comment on table public.auth_access_tokens is
  'Server-only mapping of SHA-256 access-token digests to Supabase Auth users.';
comment on column public.auth_access_tokens.token_hash is
  'SHA-256 hex digest of a generated access token; never contains the raw token.';


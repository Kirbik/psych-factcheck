-- Stores only digests for access tokens that have been generated but not yet
-- used to complete registration. Raw token values are returned once to the UI.
create table public.auth_pending_access_tokens (
  token_hash text primary key
    check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check (expires_at > created_at)
);

create index auth_pending_access_tokens_expires_at_idx
  on public.auth_pending_access_tokens (expires_at);

alter table public.auth_pending_access_tokens enable row level security;

revoke all on table public.auth_pending_access_tokens from anon, authenticated;
grant select, insert, update, delete on table public.auth_pending_access_tokens to service_role;

comment on table public.auth_pending_access_tokens is
  'Server-only digests of generated access tokens awaiting first-time registration.';
comment on column public.auth_pending_access_tokens.token_hash is
  'SHA-256 hex digest of a generated token; never contains the raw token.';

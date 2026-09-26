-- Maps a one-time-displayed recovery code digest to an existing Auth identity.
-- The raw recovery code is generated on the server and never stored in PostgreSQL.
create table public.auth_recovery_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null unique
    check (code_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

alter table public.auth_recovery_codes enable row level security;

revoke all on table public.auth_recovery_codes from anon, authenticated;
grant select, insert, update, delete on table public.auth_recovery_codes to service_role;

comment on table public.auth_recovery_codes is
  'Server-only mapping of one-time-displayed recovery-code digests to Supabase Auth users.';
comment on column public.auth_recovery_codes.code_hash is
  'SHA-256 hex digest of a random 256-bit recovery code; never contains the raw code.';

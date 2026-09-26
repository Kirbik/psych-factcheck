# Authentication

## Scope

Authentication uses a server-generated access token instead of personal
credentials. Registration creates a token-backed Supabase Auth identity and
returns a separate random recovery code once. The raw recovery code is never
persisted; only its digest is stored for a future support-assisted recovery
flow. No public recovery flow or support token-rotation interface is currently
implemented.

## Session flow

1. Registration asks a Server Action to generate an access token; only its
   digest is temporarily stored in `auth_pending_access_tokens`.
2. The user registers with that token. The server consumes the pending token,
   creates the Auth identity, stores the access-token digest and a separate
   recovery-code digest, then returns the raw recovery code exactly once.
3. Login resolves the access-token digest through the server-only service-role
   client and signs in through the regular Supabase Auth password flow.
4. Supabase stores the session in cookies. `src/proxy.ts` refreshes those
   cookies for dashboard requests and performs an early redirect for visitors
   without valid claims.
5. Protected pages independently call `auth.getClaims()` server-side before
   rendering. The Proxy is not the authorization boundary.
6. Logout calls `auth.signOut()` through the server cookie client.

## Client and server boundaries

Browser UI does not access Supabase directly for authentication. Server
Actions create the session using the request-scoped cookie client from
`src/server/supabase/auth.ts`; `@supabase/ssr` writes the session cookies.
`src/proxy.ts` refreshes them, and protected pages independently validate
claims server-side.

`src/server/supabase/server.ts` remains the explicit bearer-token client for
non-browser user-context operations. `src/server/supabase/admin.ts` is
server-only; it is used only for privileged token lookup and Auth provisioning.
The service-role key never enters client code and is not used for ordinary
user-owned operations.

## Profile lifecycle and RLS

The `on_auth_user_created` database trigger creates `public.profiles` rows.
Its `security definer` function resides in the private `app_private` schema,
not the Data API-exposed `public` schema. The application does not insert
profiles from the browser or Server Actions. RLS remains the database
authorization boundary; a logged-in user may read and update only their profile
and cannot read another user's rows.

`public.auth_recovery_codes` stores a SHA-256 digest of a random 256-bit
`pfr_...` code. Because the value has high entropy, digest lookup does not rely
on a user-chosen secret. RLS is enabled and direct grants to `anon` and
`authenticated` are revoked; only the server-side service-role client can
access this table. The registration response shows the raw recovery code once,
alongside the access token. A separately protected support process must be
implemented before the code can be used to recover an account.

## Test requirements

E2E protected-route and signup coverage requires the normal public
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` values. Login
and logout coverage additionally require a test token in `E2E_SUPABASE_TOKEN`.
The database integration suite requires `SUPABASE_TEST_DB_URL`; without it,
Vitest marks this environment-dependent suite skipped. Cloud-only deployment
does not require starting a local Supabase stack.

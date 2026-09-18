# Authentication

## Scope

Session 3 implements email/password signup, login, logout, and the protected
`/dashboard` route. Social login, password recovery, MFA, and profile editing
are intentionally not implemented.

## Session flow

1. A user submits a signup or login form to a Server Action.
2. The action validates the credentials with Zod and uses the server-side
   Supabase cookie client. Provider errors are mapped to safe user messages.
3. Supabase stores the session in cookies. `src/proxy.ts` refreshes those
   cookies for dashboard requests and performs an early redirect for visitors
   without valid claims.
4. `/dashboard` independently calls `auth.getClaims()` server-side before
   rendering. The Proxy is not the authorization boundary.
5. Logout calls `auth.signOut()` through the server cookie client and redirects
   to `/login` after Supabase clears the cookies.

## Client and server boundaries

`src/lib/supabase/browser.ts` constructs the public browser client with
`@supabase/ssr`. `src/server/supabase/auth.ts` creates one cookie-based server
client per request. Its caller can write cookies only in Server Actions; the
Proxy handles refreshes before protected pages render.

`src/server/supabase/server.ts` remains the explicit bearer-token client from
Session 2 for non-browser user-context operations. `admin.ts` is server-only
and is not used by normal authentication flows.

## Profile lifecycle and RLS

The `on_auth_user_created` database trigger creates `public.profiles` rows.
Its `security definer` function resides in the private `app_private` schema,
not the Data API-exposed `public` schema. The application does not insert
profiles from the browser or Server Actions. RLS remains the database
authorization boundary; a logged-in user may read and update only their profile
and cannot read another user's rows.

## Local test requirements

The Supabase Auth integration test needs a local project and
`SUPABASE_TEST_URL` plus `SUPABASE_TEST_ANON_KEY`. It creates a disposable
local test account, verifies the trigger-created profile through RLS, and then
signs out. E2E protected-route and signup coverage requires the normal public
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` values. Login
and logout coverage additionally require a confirmed local test account in
`E2E_SUPABASE_EMAIL` and `E2E_SUPABASE_PASSWORD`.

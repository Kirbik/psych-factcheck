# Supabase Foundation

Session 2 introduces only PostgreSQL/Auth schema readiness and typed clients. It does not implement authentication UI, file uploads or Storage, background work, AI, billing, or external integrations.

## Dependencies

- `@supabase/supabase-js` creates typed browser and server API clients.
- `server-only` makes accidental imports of privileged server modules fail at the Next.js boundary.
- `pg` and `@types/pg` are development-only and execute integration checks against a real PostgreSQL database.

## Environment and client boundaries

Copy `.env.example` to `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

This project retains the `ANON_KEY` name because it is the stable key emitted by local Supabase and supported by the current SDK. It is a public, RLS-limited API key, not a secret. Hosted projects that issue a publishable key may place that value in the same `NEXT_PUBLIC_SUPABASE_ANON_KEY` variable; the SDK accepts it. The service-role key is never public and must remain only in server environment configuration.

`src/lib/supabase/browser.ts` is marked `"use client"` and validates only the public URL/key when requested. Session 3 uses `@supabase/ssr` cookie clients for browser authentication and Server Actions; `src/proxy.ts` refreshes dashboard-session cookies, and protected pages validate claims server-side as the final authorization check. `src/server/supabase/server.ts` remains server-only and requires an explicit authenticated bearer token; it still uses the public key so PostgreSQL RLS applies. `src/server/supabase/admin.ts` is server-only and is the only place that reads `SUPABASE_SERVICE_ROLE_KEY`; it bypasses RLS and must not be used for ordinary user-owned requests. Public/server configuration validates at client construction time, keeping static builds and dev startup independent of unconfigured Supabase.

## Migrations and schema

All schema changes live in `supabase/migrations`. The initial migration creates:

- `profiles`, linked one-to-one to `auth.users`;
- `content_items`, owned by a profile, with constrained `video` type and `pending`/`ready`/`failed` status;
- `analysis_jobs`, owned by the same user as its referenced content item, with constrained lifecycle status.

It also adds foreign keys, query indexes, UTC timestamps, `updated_at` triggers, and an idempotent `auth.users` trigger that creates a profile. The profile trigger's `security definer` function lives in the private `app_private` schema, never in the exposed `public` schema. Run local migrations from a clean local stack:

```bash
pnpm dlx supabase@latest start
pnpm dlx supabase@latest db reset
```

For a hosted linked project, review the target first and then apply the checked-in migration:

```bash
pnpm dlx supabase@latest link --project-ref <project-ref>
pnpm dlx supabase@latest db push
```

Never place credentials in migrations. Use local development for RLS changes first and apply hosted migrations only through the reviewed workflow.

## Types

`src/types/database.ts` is the checked-in generated-contract file for the initial migration. After every migration, regenerate it and review the diff:

```bash
pnpm dlx supabase@latest gen types typescript --local --schema public > src/types/database.ts
```

For hosted generation, replace `--local` with `--project-id <project-ref>` after authenticating the CLI. The application must not hand-maintain duplicate domain models; types describe the database API and domain types remain separate.

## RLS

RLS is enabled on every implemented user-owned table. Authenticated users can select and update only their own profile; the profile trigger is responsible for inserts. They can create, read, update, and delete only content items whose `user_id` equals `auth.uid()`. They can read only their own analysis jobs; no client policy permits writing jobs because future trusted workflow code owns those transitions. Anonymous users receive no grants to user-owned tables.

The explicit `(content_item_id, user_id)` foreign key on `analysis_jobs` prevents an ownership mismatch even in privileged code. Repository helpers accept a user-context client and apply an explicit owner filter as defense in depth; RLS remains the database authorization source.

## Database integration tests

Start and reset the local stack, then provide the local Postgres connection URL:

```bash
$env:SUPABASE_TEST_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
pnpm test:db
```

The test connects to real local PostgreSQL, temporarily assumes Supabase `authenticated`/`anon` roles, and sets the same JWT claim values used by `auth.uid()`. It verifies migration artifacts and policies rather than mocking them. `pnpm test:integration` includes this suite. Without `SUPABASE_TEST_DB_URL`, Vitest marks this environment-dependent suite skipped; this is an explicit limitation, not proof that RLS passed. Hosted database tests are intentionally not automated to avoid destructive test data and credential exposure.

## Video upload

Session 4 adds the private `videos` Storage bucket through
`20260913000000_video_upload.sql`. Objects use the server-generated path
`<auth-user-id>/<random-id>.<extension>`; Storage policies allow only that
user to insert, read, update, or delete objects. The upload route verifies the
file container and metadata server-side before inserting `content_items`, and
removes an uploaded object if the database insert fails.

The implementation accepts MP4, WebM, and MOV files up to 100 MiB. Apply the
migration with the reviewed local/hosted workflow above and regenerate
`src/types/database.ts` with the Supabase CLI after schema changes.

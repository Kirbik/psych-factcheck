# Supabase Foundation

## Current implementation status

Supabase is used by the application, rather than being only a planned integration. The current code provides typed browser/server/admin clients, token-based registration and login through Supabase Auth, cookie sessions, a protected dashboard, owned content listing, and a server-validated direct-to-Storage TUS video upload backed by a private bucket. Migrations also define profile, content, job, access-token, pending-token, and recovery-code tables.

The applied Session 5 migration atomically queues a preparation job with uploaded content. Trigger.dev Development worker is configured; production deployment and full browser acceptance remain pending. Transcription, AI, evidence retrieval and report persistence remain future scope. See [Workflows](WORKFLOWS.md) and [Authentication](AUTH.md).

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

`src/lib/supabase/browser.ts` is marked `"use client"` and validates only the public URL/key when requested. Authentication uses a server-generated 256-bit token as the user's Supabase Auth password, paired with a random internal email on the reserved `.invalid` domain. The raw token is returned once at registration; `public.auth_access_tokens` stores only its SHA-256 digest and user ID, and has no grants for `anon` or `authenticated`. Token lookup and Auth account provisioning use `src/server/supabase/admin.ts` on the server only. After lookup, `@supabase/ssr` signs in through the regular Auth password flow and stores the session in cookies; `src/proxy.ts` refreshes dashboard-session cookies, and protected pages validate claims server-side as the final authorization check. `src/server/supabase/server.ts` remains server-only and requires an explicit authenticated bearer token; it still uses the public key so PostgreSQL RLS applies. The service-role key bypasses RLS and must not be used for ordinary user-owned requests. Public/server configuration validates at client construction time, keeping static builds and dev startup independent of unconfigured Supabase.

For direct video uploads, the authenticated `POST /api/uploads/video` response
supplies the Storage upload endpoint and the public publishable/anon key from
the server's runtime configuration. The browser does not read Supabase values
from the production client bundle; this supports builds promoted between
environments where public values are configured only on the deployed Worker.

Registration uses only the server-generated access token; no codeword is collected or stored. A separate random recovery code is generated server-side after account creation. Its raw value is staged with the token in the current browser tab's `sessionStorage` until the first successful sign-in, then shown once in the checks UI and removed from storage. The server stores only the recovery code's SHA-256 digest in `public.auth_recovery_codes`. If the tab is closed before sign-in, the staged raw values are lost. RLS is enabled and direct access is limited to the service-role client. This schema supports a future protected support recovery process; no public recovery endpoint is exposed.

## Migrations and schema

All schema changes live in `supabase/migrations`. The initial migration creates:

- `profiles`, linked one-to-one to `auth.users`;
- `content_items`, owned by a profile, with constrained `video` type and `pending`/`ready`/`failed` status;
- `analysis_jobs`, owned by the same user as its referenced content item, with constrained lifecycle status.

It also adds foreign keys, query indexes, UTC timestamps, `updated_at` triggers, and an idempotent `auth.users` trigger that creates a profile. The profile trigger's `security definer` function lives in the private `app_private` schema, never in the exposed `public` schema. Run local migrations from a clean local stack:

The token-auth migrations add `auth_access_tokens`, `auth_pending_access_tokens`, and `auth_recovery_codes`. They store SHA-256 digests, never raw access or recovery tokens. RLS is enabled, client grants are revoked, and only the server's service-role client may access them. Pending registration tokens expire after 24 hours and are consumed once.

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

`src/types/database.ts` is the checked-in generated-contract file for the current public schema. After every migration, regenerate it and review the diff:

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

The private `videos` Storage bucket is created by
`20260913000000_video_upload.sql`. Objects use the server-generated path
`<auth-user-id>/<random-id>.<extension>`. Storage RLS scopes insert, select,
update, and delete to the first path segment matching `auth.uid()`.

The hosted project was rechecked on 2026-09-27: the bucket is private,
`file_size_limit` is 104857600 (100 MiB), and `allowed_mime_types` contains
`video/mp4`, `video/webm`, and `video/quicktime`. The duplicate migration version
was resolved by retaining `20260926000000_token_auth.sql` (confirmed in hosted
history) and renaming the unapplied direct-upload settings migration to
`20260927090000_direct_video_upload.sql`. A dry run showed only that migration
and `20260927100000_analysis_workflow.sql`; both were then applied successfully.
The public DB types were regenerated against the resulting hosted schema.

`POST /api/uploads/video` authenticates the user, validates the proposed
filename and size, and returns a signed upload token for one generated object
path. The browser sends video bytes directly to Supabase Storage using the
signed TUS endpoint `/storage/v1/upload/resumable/sign` and 6 MiB chunks, so
video payloads do not pass through the application host or its Cloudflare
body-size limit. The root-layout upload provider keeps the task alive through
in-app route navigation only; a full page reload, closed tab, or browser restart
interrupts the in-memory task, and durable resume is not implemented. After
TUS completion,
`POST /api/uploads/video/complete` verifies the path belongs to the caller,
reads Storage's actual object size and checks a server-fetched byte-range
signature before writing an idempotent owned `content_items` record. MIME is
derived from the validated extension and container signature, not from the
browser. Storage cleanup is attempted on validation or database failures when
safe to do so.

The application accepts MP4, WebM, and MOV files up to 100 MiB. On success,
the row remains `pending`: no analysis workflow currently advances it. Apply
migrations with the reviewed local/hosted workflow above; no database columns
changed, so `src/types/database.ts` does not need regeneration for the bucket
settings migration.

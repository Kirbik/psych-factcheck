# Background workflow — Session 5

## Scope and honest completion

`orchestration-v1` is a real Trigger.dev task, without AI stages. It reads the
owned content row, checks the object path, actual Storage size, MIME/extension
agreement and a bounded container signature, then persists `completed` on the
job. This means preparation completed, not fact checking. `content_items.status`
stays `pending`; no transcript, claims, evidence or report is produced.

The hosted migrations and Development worker configuration were applied on
2026-09-27. Production worker deployment and browser end-to-end acceptance
remain pending. See the live verification log in `docs/testing/SESSION_5.md`. Missing
`TRIGGER_SECRET_KEY` returns HTTP 503 with an explicit unavailable message;
uploads remain saved. No fake executor runs in production.

## Durable state and concurrency

- A database trigger creates the queued job in the same transaction as the new
  content row. Leaving `/new-check` cannot prevent job creation.
- `(content_item_id, pipeline_version)` is unique. The owner-only
  `request_analysis_job` RPC locks the content row and returns the existing job.
- An explicit retry passes the failed/cancelled generation. Only a matching
  terminal generation increments; repeated requests cannot reset newer work.
- `advance_analysis_job` is service-role-only. Updates compare the job ID,
  generation and run ID and accept only valid state transitions. Terminal
  states cannot regress. Failed hooks from old workers cannot overwrite retries.
- Trigger uses a global idempotency key `jobId:generation` (24 hours). Database
  fencing remains effective after the provider key expires.
- The minute schedule dispatches queued jobs with no run ID and reconciles
  active runs. This closes the enqueue crash gap and covers failures that do
  not execute `onFailure`, including cancellation, expiration and worker crashes.
- The scheduler reads the oldest 100 active jobs per tick. This is an MVP
  throughput bound, not a production-scale queue dispatcher.

Lifecycle: `queued → running → completed/failed/cancelled`; interrupted queued
runs can also fail/cancel. Stage is `queued`, `validate_upload`, or `complete`.
`generation` counts explicit restarts; `attempt` records Trigger retries within
one run. Technical errors returned to the browser are fixed messages, never
raw provider errors. The task retries transient failures three times; permanent
invalid-upload failures abort retries. Fetches have a 15-second timeout and the
task has a 60-second compute limit.

## API and UI

`POST /api/analysis` takes `{ contentItemId, retryGeneration? }`. It checks the
same origin, session, bounded JSON and ownership using a user-context client
before privileged dispatch. `GET /api/analysis?contentItemId=...` reads/reconciles
an existing owned job. Responses are private/no-store and expose only job ID,
generation, status, stage, attempt and a safe error code.

After upload, `/new-check` displays progress and requests immediate dispatch.
`/dashboard` links to `/processing?contentItemId=...` for saved uploads. Reloads
read the durable job. The UI polls every two seconds while active, stops on a
terminal state/error, and offers an explicit retry. The existing six analysis
steps remain pending after upload, and report navigation stays disabled.

UI uses the existing processing screen styles and replaces the disabled report
action with retry in the same location when needed. No new CSS tokens, icons or
layout rules are introduced. The approved Figma source is not supplied in this
session; visual acceptance against Figma remains pending.

## Setup and deployment

1. The duplicate version was resolved after checking hosted history: token auth
   retains `20260926000000`; direct-upload settings use `20260927090000`.
   Both the bucket-settings and workflow migrations are applied to the linked
   project. Review other environments before applying. See [Supabase](SUPABASE.md).
2. `20260927100000_analysis_workflow.sql` requires foundation, private schema
   and video-upload migrations. `src/types/database.ts` was regenerated from
   the applied hosted public schema with the Supabase CLI.
3. Create/select a Trigger.dev project and set `TRIGGER_PROJECT_REF` and the
   environment-specific `TRIGGER_SECRET_KEY` on the app server. Never use a
   `NEXT_PUBLIC_` name for the Trigger secret.
4. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the Trigger worker
   environment, independently of the web host. Use a dedicated test project
   during verification. Worker credentials never enter task payloads.
5. Run `pnpm dlx trigger.dev@4.6.4 dev start --project-ref proj_tkaqtbbcpubpdchxpjas --env-file .env.local` for development.
   The project ref must also be available to `trigger.config.ts`. Production
   deployment uses `pnpm dlx trigger.dev@4.6.4 deploy` with the reviewed project
   and environment. Development schedules run only while the dev worker is up.
   The CLI `--env-file` loads CLI configuration, not task secrets: configure the
   worker environment from step 4 in Trigger.dev for both development and production.
6. Confirm the `reconcile-analysis-jobs` minute schedule is active. This is
   required for upload-triggered dispatch and failure recovery without an open UI.
7. Verify upload → one queued job → running → completed, duplicate start,
   worker failure, explicit retry and reload. Check that the content remains
   pending and no report is advertised.

Tasks execute in Trigger's Node worker independently of Next/Vinext. Shared
worker modules deliberately avoid the React `server-only` marker; the web
composition boundary uses it and the worker client imports `node:process`.

## Tests and limits

Unit tests exercise malformed input, stale generations, enqueue ambiguity,
completion races, failures, safe responses and bounded byte reads. PGlite runs
the real application SQL for ownership, grants, RLS, atomic job creation,
transitions, retries and fencing in isolated PostgreSQL. Its single connection
does not prove multi-connection lock contention or Supabase service behavior.
Playwright exercises progress, reload, retry and unavailable states with the
API mocked; it does not establish real Trigger/Storage connectivity.

Before accepting Session 5, complete browser upload/retry/crash integration,
the environment-gated RLS/auth/upload tests and visual comparison with approved
Figma. Hosted bucket size/MIME settings and generated DB types are verified.

References: [Trigger tasks](https://trigger.dev/docs/tasks/overview),
[idempotency](https://trigger.dev/docs/idempotency),
[scheduled tasks](https://trigger.dev/docs/tasks/scheduled).

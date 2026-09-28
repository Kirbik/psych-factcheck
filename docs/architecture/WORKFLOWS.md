# Background workflow — Session 5

## Scope and completion

`analysis-preparation-v1` is a Cloudflare Workflow without AI stages. It reads
the owned content row, checks the Storage object path, actual size, MIME and
extension agreement, and a bounded container signature, then persists
`completed` on the job. This means upload preparation completed, not fact
checking. `content_items.status` stays `pending`; no transcript, claims,
evidence, or report is produced.

The application Worker hosts the workflow binding and a minute cron that
dispatches queued jobs and reconciles interrupted runs. Supabase remains the
source of truth for job state and ownership. The Production dashboard has the
binding and cron configured and records one completed Workflow instance;
verification of the corresponding Supabase job state and browser end-to-end
acceptance remain pending. If the Worker binding is unavailable, the API
returns HTTP 503 with an explicit unavailable message; uploads remain saved.
There is no fake executor in production.

## Durable state and concurrency

- A database trigger creates the queued job in the same transaction as the new
  content row. Leaving `/new-check` cannot prevent job creation.
- `(content_item_id, pipeline_version)` is unique. The owner-only
  `request_analysis_job` RPC locks the content row and returns the existing job.
- An explicit retry passes the failed/cancelled generation. Only a matching
  terminal generation increments; repeated requests cannot reset newer work.
- `advance_analysis_job` is service-role-only. Updates compare the job ID,
  generation and workflow instance ID and accept only valid state transitions.
  Terminal states cannot regress. Old workflow executions cannot overwrite
  retries.
- Cloudflare Workflow instance IDs are deterministic per job generation, so an
  ambiguous start can safely retrieve the existing instance. Database fencing
  remains effective independently of Workflow state retention.
- A Worker cron runs every minute. It dispatches queued jobs without an
  instance ID and reconciles active instances. This closes the enqueue crash
  gap and covers failures that do not persist a terminal job state.
- The scheduler reads the oldest 100 active jobs per tick. This is an MVP
  throughput bound, not a production-scale queue dispatcher.

Lifecycle: `queued → running → completed/failed/cancelled`; interrupted queued
runs can also fail or cancel. Stage is `queued`, `validate_upload`, or
`complete`. `generation` counts explicit restarts; `attempt` records Workflow
step retries. Technical errors returned to the browser are fixed messages,
never raw provider errors. The preparation step retries transient failures up
to three total attempts. Permanent invalid-upload failures stop immediately.
Storage fetches have a 15-second timeout and the step has a 60-second timeout.

## API and UI

`POST /api/analysis` takes `{ contentItemId, retryGeneration? }`. It checks the
same origin, session, bounded JSON and ownership using a user-context client
before privileged dispatch. `GET /api/analysis?contentItemId=...` reads and
reconciles an existing owned job. Responses are private/no-store and expose
only job ID, generation, status, stage, attempt, a safe error code, and the
public Supabase URL/key needed to connect to Realtime at Worker runtime. The
anonymous key is public; table access remains protected by RLS.

After upload, `/new-check` displays progress and requests immediate dispatch.
`/dashboard` links to `/processing?contentItemId=...` for saved uploads.
Reloads read the durable job, then listen for `analysis_jobs` changes through
Supabase Realtime. Owner RLS applies to the subscription. If the socket is
disconnected, the UI checks status every ten seconds until the subscription
recovers; returning to a visible tab triggers a fresh read. An explicit retry
still goes through the API. The existing analysis steps remain pending after
upload, and report navigation stays disabled.

No UI or CSS changes are part of the workflow runtime migration.

## Setup and deployment

1. Apply the reviewed Supabase migrations for upload, analysis jobs, and the
   Realtime publication (`20260928100000_analysis_jobs_realtime.sql`).
2. Configure `NEXT_PUBLIC_SUPABASE_URL` and the server-only
   `SUPABASE_SERVICE_ROLE_KEY` in the Cloudflare Worker environment. Keep the
   service-role value as a Worker secret; do not put it in client code or task
   payloads.
3. `wrangler.jsonc` declares the `ANALYSIS_WORKFLOW` binding and the minute
   cron. Run `pnpm dev:vinext` to exercise the app, workflow and scheduled
   handler locally through the Cloudflare runtime.
4. Run `pnpm build:vinext`, then deploy with the project's Cloudflare Worker
   deployment pipeline. No separate workflow service, project, or API key is
   required.
5. The Production dashboard has confirmed the `analysis-preparation-v1`
   Workflow binding, minute cron and one completed instance.
6. Verify the corresponding Supabase job reached `completed`, then test a fresh
   upload, duplicate start, worker failure, explicit retry and reload. Check
   that the content remains pending and no report is advertised.

Tasks execute in the Cloudflare Worker runtime, separately from the web
request. Shared workflow modules depend on domain and repository contracts,
not on a vendor client. The Worker entrypoint passes its bindings into the
workflow and scheduled recovery handlers.

## Tests and limits

Unit tests exercise malformed input, stale generations, ambiguous enqueue,
completion races, failures, safe responses and bounded byte reads. PGlite runs
the real application SQL for ownership, grants, RLS, atomic job creation,
transitions, retries and fencing in isolated PostgreSQL. Its single connection
does not prove multi-connection lock contention or Supabase service behavior.
Playwright exercises progress, reload, retry and unavailable states with the
API mocked; it does not establish real Cloudflare/Storage connectivity.

Before accepting Session 5, complete browser upload/retry/crash integration,
the environment-gated RLS/auth/upload tests and visual comparison with
approved Figma. Hosted bucket size/MIME settings and generated DB types are
verified.

References: [Cloudflare Workflows](https://developers.cloudflare.com/workflows/),
[triggering Workflows](https://developers.cloudflare.com/workflows/build/trigger-workflows/),
[Worker bindings](https://developers.cloudflare.com/workers/wrangler/configuration/).

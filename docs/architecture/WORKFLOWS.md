# Background workflow — Sessions 5–6A

## Scope and completion

The Session 5 `analysis-preparation-v1` workflow validated uploaded videos
only. Session 6 changes the source binding to `analysis-transcription-v1`: it
checks the owned content row, Storage path, actual size, MIME and extension
agreement, and container signature, then transcribes supported MP4/WebM files
up to 25 MB with OpenAI `whisper-1`. The adapter requests segment timestamps
in `verbose_json`, validates the response with Zod, and persists one immutable
transcript per content item and `transcription-v1` version. Content remains
`pending`; claims, evidence, and reports are not produced.

Session 6A adds `screen_video` between upload validation and full
transcription. For videos longer than 40 seconds with a supported audio track,
the Worker demuxes and remuxes no more than three four-second audio ranges
using Mediabunny; it does not decode media or send the full video to the
screening transcription request. The short sample is transcribed by
`whisper-1`, then `gpt-4o-mini` returns a strict structured decision. Zod
validates both API responses. Only `unrelated` with confidence >= 0.9 and an
out-of-scope reason completes the job early with `VIDEO_OUT_OF_SCOPE`. Every
other result, unsupported sample, or screening error proceeds to full
transcription. Videos at or below 40 seconds skip sample API calls and proceed
directly to full transcription.

The `video_screenings` table stores one result per content item and
`topic-screening-v1`: decision, reason code, confidence, brief rationale,
sample duration, provider/model identifiers, and instruction version. It does
not store the sample transcript. The service role is the only role with table
access. Retried generations reuse this row; workflow step replay plus the
unique key prevents duplicate screening records.

The application Worker hosts the workflow binding and a minute cron that
dispatches queued jobs and reconciles interrupted runs. Supabase remains the
source of truth for job state and ownership. The Production dashboard has the
Session 6 binding and cron configured, and the transcription migration and
`OPENAI_API_KEY` Worker secret are deployed. On 2026-09-30, a Production job
completed with `stage = complete` and its matching `transcripts` row. The user
confirmed a successful live transcription. The automated E2E suite uses mocked
workflow APIs and skips dedicated live auth/upload cases. If the Worker binding is unavailable, the API
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
runs can also fail or cancel. Stage is `queued`, `validate_upload`,
`screen_video`, `transcribe_video`, or `complete`. `generation` counts explicit restarts;
`attempt` records Workflow step retries. Technical errors returned to the
browser are fixed messages, never raw provider errors. The step retries
transient failures up to three total attempts. OpenAI requests time out after
180 seconds, full Storage downloads after 60 seconds, and the Workflow step
after 4 minutes. Permanent input/configuration errors stop immediately.

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
still goes through the API. The upload validation and transcript steps update
their existing progress states; claim/evidence/report steps remain pending,
and report navigation stays disabled.

During a video byte upload, reloading the page interrupts the TUS transfer.
The same tab restores the paused upload from `sessionStorage` and then shows
the saved progress, without rendering the analysis-stage screen during client
state restoration. The user resumes the original file when the browser's
stored file handle and TUS upload URL remain available; otherwise they select
the original file again. Cancel clears the upload state so another file can be
chosen. Returning from completed progress to a new check also clears the old
file selection.

Session 6A adds status copy for the existing progress screen and the existing
terminal job contract; it adds no CSS, layout, or visual pattern.

## Setup and deployment

1. Apply the reviewed Supabase migrations for upload, analysis jobs, and the
   Realtime publication (`20260928100000_analysis_jobs_realtime.sql`).
2. Configure `NEXT_PUBLIC_SUPABASE_URL`, the server-only
   `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` in the Cloudflare Worker
   environment. Keep both secrets as Worker secrets; do not put them in client
   code, variables, or task payloads.
3. `wrangler.jsonc` declares the `ANALYSIS_WORKFLOW` binding and the minute
   cron. Run `pnpm dev:vinext` to exercise the app, workflow and scheduled
   handler locally through the Cloudflare runtime.
4. Run `pnpm build:vinext`, then deploy with the project's Cloudflare Worker
   deployment pipeline. No separate workflow service, project, or API key is
   required.
5. Apply `20260930120000_transcription_v1.sql`, deploy the Worker with the
   `analysis-transcription-v1` binding, and set `OPENAI_API_KEY` with
   `wrangler secret put OPENAI_API_KEY`. **Completed for Production on 2026-09-30.**
6. **Production live verification completed on 2026-09-30:** the user confirmed
   a successful transcription and the matching completed job/transcript row
   were verified in Supabase. Automated tests cover duplicate start, retry,
   provider failure and reload. Content remains pending with no report; MOV
   and larger files currently fail explicitly.

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

Session 6A unit tests cover sample-window selection, request construction with
the extracted sample, strict response validation, fail-open decisions, terminal
out-of-scope progress, and screening row idempotency. They do not run media
demux/remux against real MP4/WebM fixtures, establish model classification
quality, or verify Production behavior. `pnpm evals` validates synthetic
fixture structure; it does not call OpenAI or measure
false-positive/false-negative rates.

Before accepting Session 5, complete browser upload/retry/crash integration,
the environment-gated RLS/auth/upload tests and visual comparison with
approved Figma. Hosted bucket size/MIME settings and generated DB types are
verified.

References: [Cloudflare Workflows](https://developers.cloudflare.com/workflows/),
[triggering Workflows](https://developers.cloudflare.com/workflows/build/trigger-workflows/),
[Worker bindings](https://developers.cloudflare.com/workers/wrangler/configuration/).

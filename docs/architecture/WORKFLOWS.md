# Background workflow — Sessions 5–12

## Scope and completion

The Session 5 `analysis-preparation-v1` workflow validated uploaded videos
only. Session 6 changed the source binding to `analysis-transcription-v1`: it
checks the owned content row, Storage path, actual size, MIME and extension
agreement, and container signature, then transcribes supported MP4/WebM files
up to 25 MB with OpenAI `whisper-1`. The adapter requests segment timestamps
in `verbose_json`, validates the response with Zod, and persists one immutable
transcript per content item and `transcription-v1` version. Content remains
`pending`; claims, evidence, and reports were not produced by Session 6.

Session 6A adds `screen_video` between upload validation and full
transcription. For videos longer than 12 seconds with a supported audio track,
the Worker demuxes and remuxes no more than three four-second audio ranges
using Mediabunny; it does not decode media or send the full video to the
screening transcription request. The short sample is transcribed by
`whisper-1`, then `gpt-4o-mini` returns a strict structured decision. Zod
validates both API responses. Only `unrelated` with confidence >= 0.9 and an
out-of-scope reason completes the job early with `VIDEO_OUT_OF_SCOPE`. Every
other result, unsupported sample, or screening error proceeds to full
transcription. Videos at or below 12 seconds are screened using their full
audio track. If MP4 metadata omits audio duration, the Worker computes it from
encoded packet timestamps. If duration still cannot be determined, screening
fails open and full transcription proceeds.

The `video_screenings` table stores one result per content item and
screening version: decision, reason code, confidence, brief rationale,
sample duration, provider/model identifiers, and instruction version. It does
not store the sample transcript. The service role is the only role with table
access. `topic-screening-v2` covers psychology, mental health, human behavior,
cognitive science, psychotherapy, adult romantic relationships, couple
communication/conflicts, trust, attachment, adult sexual relationships, and
adult sexual health. Retried generations reuse a row for the same screening
version; a version bump triggers screening on the next eligible fresh run.

Session 7 adds OpenAI `gpt-4o-mini` structured claim extraction after
transcription. The versioned instruction at
`src/server/ai/prompts/claim-extraction-v1.ts` tells the model to extract
checkable propositions, preserve qualification and causal strength, omit
non-claims, and treat transcript text as untrusted data. The model returns an
exact source excerpt and inclusive transcript segment indexes; server code
validates the excerpt and derives timestamps from the persisted segments.
Responses use the OpenAI Responses API with strict JSON Schema and local Zod
validation. One repair call is allowed for invalid or transcript-inconsistent
output. Transcript input is capped at 100,000 characters; larger transcripts
fail explicitly rather than being silently truncated.

`claim_extractions` stores one successful extraction marker per transcript
and version, including empty results, plus provider/model/instruction/schema
versions. `claims` stores each source excerpt, normalized statement, claim
type, timestamp range, and ordinal. A service-role-only database function
persists the marker and claims atomically; owner RLS exposes reads. Retries
reuse existing extraction records. The job pipeline version is
`claim-extraction-v1`, and stage `extract_claims` follows `transcribe_video`.
The migration requeues previously completed in-scope transcription jobs so
they can run claim extraction while preserving completed `VIDEO_OUT_OF_SCOPE`
jobs. Sessions 6A–7 are deployed in Production. Earlier claim-extraction
attempts failed because model excerpts/segment indexes did not pass source
validation; matching and schema-limit fixes were deployed on 2026-09-30. A
Production job later completed through claim extraction. This confirms one
successful workflow run, not extraction quality. The screening duration
fallback was deployed on 2026-09-30; the previously affected clip must be
uploaded again to verify the fresh screening path.

Sessions 9–10 add the deployed evidence stages after extraction. The Worker
embeds normalized claims in a batch, searches active Evidence Base chunks with
the versioned pgvector RPC and metadata filters, deterministically reranks the
validated candidates, and persists a bounded Evidence Package per claim.
`build_evidence` uses an idempotent database RPC; package rows and ordered
chunk links are owner-readable through RLS. Empty or narrow retrieval is saved
with explicit coverage and warnings. This stage does not assign a verdict.
Migration `20261001140000_evidence_packages_v1.sql` and Worker version
`7279e730-7eae-4a78-8126-2a67ebf045ed` were deployed on 2026-10-01. Existing
completed jobs were not requeued; a new upload is needed to verify this stage
in a live analysis.

Session 12 connects the Session 11 evidence-bound judgment service after
Evidence Package persistence. The Worker validates each current package,
judges its claim with `gpt-4o-mini`, and saves the immutable fact check and
package-member citations through a run-fenced fact-check RPC. It locks the job,
checks generation/run/stage and claim ownership, then calls `save_fact_check`.
Each claim judgment is a separate durable Cloudflare Workflow step. Before judging, the workflow skips
only a fact check already saved for the same claim, package, and judgment
version; retries resume unfinished claims and the idempotent SQL RPC preserves
the first saved result. Jobs enter `judge_claims` and complete only after all
claims have current persisted fact checks. Empty claim extractions complete
without model calls. Session 13 renders persisted results after this workflow
completes; report rendering does not add another Workflow stage.

The Session 12 migrations and Worker were deployed to Production on 2026-10-01.
The endpoint returned HTTP 200 and the deployed Worker exposes the workflow
binding. A fresh authenticated Production analysis completed at `stage =
complete` in generation 2; see [Session 12 verification](../testing/SESSION_12.md).

The application Worker hosts the workflow binding and a minute cron that
dispatches queued jobs and reconciles interrupted runs. Supabase remains the
source of truth for job state and ownership. The Production dashboard has the
Session 6 binding and cron configured, and the transcription migration and
`OPENAI_API_KEY` Worker secret are deployed. On 2026-09-30, a Production job
completed with `stage = complete` and its matching `transcripts` row. A later
Production generation also completed through claim extraction. The automated
E2E suite uses mocked workflow APIs and skips dedicated live auth/upload cases.
If the Worker binding is unavailable, the API returns HTTP 503 with an
explicit unavailable message; uploads remain saved.
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
`screen_video`, `transcribe_video`, `extract_claims`, `build_evidence`,
`judge_claims`, or `complete`. In-scope jobs complete after fact checks and
citations are saved. The `/report` page then assembles the view from those
persisted rows; it does not run as a Workflow step.
`generation` counts explicit restarts;
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
Supabase Realtime. Owner RLS applies to the subscription. Realtime events update
the UI immediately, and a ten-second status read reconciles missed events even
when the channel reports a connection; returning to a visible tab also triggers
a fresh read. These are GET status reads; workflow dispatch still occurs once
through POST, and an explicit retry uses the API. Upload validation, screening,
transcription, and claim extraction update the existing progress messages.
While dispatch is busy or the job is running, the message carries an animated
activity marker and `aria-busy`; the animation respects
`prefers-reduced-motion`. A completed `VIDEO_OUT_OF_SCOPE` result uses the
shared warning Alert. Evidence search has persisted progress states. Judgment remains pending until fact checks are saved; report navigation is enabled only after the job completes and carries the selected content item ID.

During a video byte upload, reloading the page interrupts the TUS transfer.
The same tab restores the paused upload from `sessionStorage` and then shows
the saved progress, without rendering the analysis-stage screen during client
state restoration. The user resumes the original file when the browser's
stored file handle and TUS upload URL remain available; otherwise they select
the original file again. Cancel clears the upload state so another file can be
chosen. Returning from completed progress to a new check also clears the old
file selection.

Session 6A adds screening status copy to the persisted progress screen.
Screening activity reuses the processing indicator pattern; terminal
out-of-scope results use the shared Alert component with the warning token.

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
7. Sessions 6A–7 and their migrations are deployed in Production. A job reached
   `complete` after claim extraction on 2026-09-30. Session 9 retrieval and
   Session 10's package migration/Worker are deployed; the latest Worker
   version is `7279e730-7eae-4a78-8126-2a67ebf045ed`. Its public endpoint
   returned HTTP 200. Browser E2E verification stalled before reporting a
   result, and a fresh analysis is still needed to verify package persistence
   end to end. A separate fresh upload remains needed for the screening
   duration fallback case. Model-quality evaluation remains outstanding.

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
false-positive/false-negative rates. Session 10 adds unit and database
integration coverage for batch retrieval and idempotent package persistence.
The Playwright attempt for the changed progress flow stalled before reporting
results, so browser E2E remains an open verification item.

Before accepting Session 5, complete browser upload/retry/crash integration,
the environment-gated RLS/auth/upload tests and visual comparison with
approved Figma. Hosted bucket size/MIME settings and generated DB types are
verified.

References: [Cloudflare Workflows](https://developers.cloudflare.com/workflows/),
[triggering Workflows](https://developers.cloudflare.com/workflows/build/trigger-workflows/),
[Worker bindings](https://developers.cloudflare.com/workers/wrangler/configuration/).

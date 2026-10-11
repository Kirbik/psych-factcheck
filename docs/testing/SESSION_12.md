# Session 12 verification — Full pipeline judgment

## Result

The Production Cloudflare Worker now continues from persisted Evidence Packages to
evidence-bound fact checks:

- The Worker invokes the Session 11 judgment service for each claim/package.
- Each claim judgment runs in its own durable Workflow step. Retries skip only
  a fact check already saved for that claim, package, and judgment version.
- Fact checks and citations use the validated repository and a service-only
  run-fenced persistence RPC. It locks and validates current job ownership,
  verifies the package claim against the stored claim, and then invokes the
  immutable `save_fact_check` integrity routine.
- Judgment refuses a package whose embedded extracted claim differs from the
  current persisted extraction.
- Jobs use the fenced `judge_claims` stage and complete after all current
  judgments are persisted. Empty claim extractions complete without judgment
  provider calls; missing packages fail explicitly.
- The processing view reports judgment progress through the existing
  “Сопоставление данных” step. Session 13 connects completion to the report.

Migrations `20261002120000_full_pipeline_judgment_stage.sql` and
`20261002130000_fenced_fact_check_persistence.sql` expand the stage constraint
and fence judgment writes by generation and workflow run. Both migrations
were applied to Production on 2026-10-01; the remote migration history was
verified afterward. Cloudflare Worker version
`1201cf3a-a17e-4782-a986-e003f24e88bb` was deployed the same day with the
`ANALYSIS_WORKFLOW` binding and minute schedule. The Production endpoint
returned HTTP 200.

There is no concrete `UsageService` or usage policy in the repository. Session
12 leaves that interface unconfigured rather than introducing a default limit
or a no-op implementation. Session 13 adds the report view; a separate stored
report artifact remains future work.

## Checks

- `pnpm lint`: PASS; two pre-existing `next/no-location-assign` warnings remain
  in `src/components/preview/history-preview.tsx`.
- `pnpm typecheck`: PASS.
- `pnpm test`: PASS — 219 passed, 5 skipped; 35 files passed, 3 environment-
  gated files skipped.
- `pnpm evals`: PASS — 4 files, 7 tests. These remain synthetic/offline checks
  and do not establish judgment quality.
- `pnpm build`: PASS.
- `pnpm build:vinext`: PASS, exit code 0. Wrangler printed an EPERM warning
  while opening its user log file; all five build stages completed.
- `pnpm test:e2e`: INCOMPLETE. Chromium started all 17 tests but the run stopped
  producing output and was interrupted. A single focused workflow E2E test
  stalled in the same way. No E2E pass is claimed.
- `pnpm check`: PASS — lint, typecheck, and full test suite. Lint reports only
  two pre-existing warnings in `history-preview.tsx`.
- Production migration check: PASS — both Session 12 migrations appear in the
  linked remote history.
- `pnpm deploy:vinext`: PASS — deployed Worker version
  `1201cf3a-a17e-4782-a986-e003f24e88bb`.
- Production endpoint health check: PASS — HTTP 200.
- Live Production workflow: PASS — job `2fb0f3e6-deea-4e46-a206-9c330ef9b32f`,
  generation 2, completed at `stage = complete` with `error_code = null` on
  2026-10-01. This verifies the authenticated analysis reached terminal
  success after judgment and fact-check persistence. Generation 1 had failed
  with `RUN_INTERRUPTED`; generation 2 completed successfully.

## Remaining verification

- Resolve the Playwright stall and pass the browser E2E suite. The live
  Production workflow succeeded, but this does not establish browser-suite
  coverage.
- Add expert-reviewed verdict/citation cases before making any judgment-quality
  claim. Current synthetic evals verify contracts, not semantic correctness.
- Confidence is an uncalibrated model output. Citation membership is checked,
  but semantic support between each passage and explanation is not evaluated.

## Production follow-up (2026-10-03)

Cloudflare Workflow instance `analysis-5c272e23-5f76-4f54-bbb9-488f299233e7-1`
completed `retrieve and package claim evidence` successfully (3.4 seconds), then
failed all five judgment-preparation attempts with
`Job read failed (Supabase error code unavailable)`. Its failure-state write
also failed with `Job transition failed (Supabase error code unavailable)`.
Generation 2 reached its judgment step and failed with
`FACT_CHECK_CITATION_OUTSIDE_PACKAGE`; the model output cited a chunk ID outside
the package, correctly rejected by server validation. Supabase PostgREST Logs
reported no data, and Worker Observability is disabled, so the generation 1
transport failure has no lower-level diagnostic yet.

The judgment schema now enumerates only the current package's chunk IDs and
permits zero citations for an empty package. The fix and publication-search
extension were deployed on 2026-10-03 in Worker version
`9b3415bf-5f13-4795-ad0c-c5debe5605df`. The production root served the
authenticated entry page after deployment. The failed generation 2 predates
the fix; no new authenticated analysis or live scientific-provider query has
been run since deployment. Model quality remains unverified without
expert-reviewed golden cases.

## Literature search extension (2026-10-03)

The workflow now has an EvidenceSearchProvider abstraction with Europe PMC and
Crossref adapters. Public search supplements local retrieval, which is not
required. Europe PMC OA full text is used only after confirming the
publication-specific CC BY 4.0 license; at most one 1,000-character excerpt
and its attribution are retained. Crossref metadata and publications whose
rights are unknown are references only and cannot support judgments. Provider,
retrieval, judgment prompt, and judgment schema versions are recorded. Stable
source/chunk keys and package uniqueness preserve retry idempotency. Existing
generation/run fencing and relational tables remain unchanged.

This implementation is deployed but not live-tested against Europe PMC or
Crossref. Europe PMC/Crossref coverage is incomplete. Synthetic contract tests
do not establish model quality; expert-reviewed golden cases are still
missing.

The 2026-10-03 repository checks for this extension passed lint, typecheck,
unit/integration tests (243 passed, 5 skipped), evals (7 passed), build, and
Playwright E2E (11 passed, 6 skipped). E2E was rerun with network access after
the sandboxed dev server stalled while fetching existing Google Fonts. No live
scientific API request or authenticated post-deployment Production workflow was
performed.

The 2026-10-03 repository checks for this extension passed lint, typecheck,
unit/integration tests (243 passed, 5 skipped), evals (7 passed), build, and
Playwright E2E (11 passed, 6 skipped). E2E was rerun with network access after
the sandboxed dev server stalled while fetching existing Google Fonts. No live
scientific API requests or Production workflow were performed.

## Production follow-up (2026-10-11)

The missing judgment migrations `20261012130000_prompt_model_verdict` and
`20261012140000_no_search_judgment_normalization` were applied and registered
in the linked Production migration history. Cloudflare Worker Observability
now reports logs and traces enabled. Logs for job
`bd97e728-d8bd-40a4-b760-7f508e0b6c1f` show Supabase requests ending with
`HTTP status 0` after the workflow had persisted fact checks; generation 5 had
10 fact checks and no report narrative. The dashboard returned no traces for
the inspected time window. Restarting only the narrative step was rejected as
`RUN_OBSOLETE` by the existing run fence. This points to a transport failure,
but the exact network cause is not yet available from Production telemetry.

The Worker fetch adapter now emits a sanitized structured log only when its
bounded retry budget is exhausted. It records method, host, broad endpoint
category, attempt count, and either a normalized network error name or final
transient HTTP status. It omits full URLs, query parameters, headers, and
bodies. This diagnostic change was deployed in Worker version
`8998bff6-f4ed-4758-981b-807340f531f1`. The next controlled retry,
generation 6, completed in 13.3 seconds; Supabase confirmed `stage = complete`,
10 persisted fact checks, and one report narrative. The retry did not exhaust
its Supabase retry budget, so the new failure diagnostic was not exercised.
This successful run verifies the complete Production path after the migrations,
but it does not establish the cause of the earlier intermittent HTTP status 0.

### Production follow-up (2026-10-11, job `bf3ce069-92cd-469b-a9a8-5ce2ab96ec99`)

Generations 1 and 2 failed during `judge_claims`. Generation 1 saved no
fact-checks; generation 2 saved 5 of 8 claims and no report narrative. Its
Cloudflare trace contains successful PostgREST `HTTP 200` spans, while the
failed step reports `Evidence package read failed` with status 0. Inspection of
the installed `postgrest-js` implementation showed that it retries the fetch
call but consumes the response body afterward, outside that retry block. A
response-stream interruption can therefore become status 0 even when headers
arrived with HTTP 200, and it bypasses the Worker fetch retry/logging boundary.

The fix buffers PostgREST response bodies inside the Worker retry wrapper so
stream failures are retried and logged with a sanitized `response_body` phase.
It was deployed to Production as Worker version
`24bc9d3c-ed7f-42be-94a8-fc78e51a7a86` on 2026-10-11. The deploy command
completed successfully and the public Worker endpoint returned HTTP 200. No
new job generation was started, so recovery of this specific analysis and the
full authenticated path after this transport fix remain unverified.

#### Production follow-up (2026-10-11, job `3397791e-5228-4706-82c8-ed782cda2134`)

Cloudflare instance `analysis-3397791e-5228-4706-82c8-ed782cda2134-1` ran on
Worker version `caa43520-7143-4082-b9a8-da44ca1c7bd1`. Screening,
transcription, claim extraction, package preparation, and judgment preparation
all succeeded. The first judgment failed while writing a fact check with
`HTTP status 0`; its two Workflow retries failed while updating the job stage
in 9–12 ms. Cloudflare Observability showed no
`Supabase fetch retry budget exhausted` log for this run. This confirms the
previous fix was deployed but did not cover the thrown-exception path seen by
this invocation; the exact transport exception is not present in retained logs.

The follow-up retries all exceptions raised while consuming a PostgREST
response body (bounded and safe for the idempotent fact-check and stage-
transition operations), and logs unexpected fetch exceptions once with
sanitized class/route metadata. It was deployed as Worker version
`9a68999b-0be2-4600-bc6a-f543e97558be` on 2026-10-11; the public endpoint
returned HTTP 200. The app browser had no authenticated session, so no
controlled retry of this job was started. The exact thrown transport exception
and a successful post-fix analysis remain unverified; do not treat the
non-`TypeError` body-stream failure as confirmed.

The supplied generation 2 was then inspected in Cloudflare. Instance
`analysis-3397791e-5228-4706-82c8-ed782cda2134-2` ran on Worker version
`748a7e41-3ef8-45d5-a7ff-f295c29b9766`, deployed at 17:14 UTC. Six claim
judgments had persisted before the next claim failed reading its evidence
package. Cloudflare logged nine `[worker] Supabase fetch failed` events during
the failed read and stage/failure-state updates. Each recorded
`phase=fetch`, `kind=unexpected_error`, `errorName=Error`, `attempts=1`; the
failed read was a PostgREST table `GET`. Thus the immediate code defect is
confirmed: the adapter retried `TypeError`, timeout and response-stream errors,
but rejected other fetch exceptions on the first attempt. The underlying
transport exception message is intentionally absent from telemetry, so its
network-level cause is still unknown.

The adapter now retries bounded unexpected fetch exceptions for the Worker's
idempotent Supabase PostgREST operations (fenced/unique RPCs, reads and
ignore-duplicate upserts) and Storage GET downloads. A regression test covers
an unexpected exception recovering on retry, exhaustion with sanitized logs,
and no retry for an unclassified endpoint. Production deployment completed at
17:25 UTC as Worker version `04fb603f-6b6a-43f1-bc79-37f4b7d333fc`; the public
Worker endpoint returned HTTP 200. No new analysis generation was triggered,
so recovery of this failed job and a complete post-fix Production workflow have
not yet been verified.

The later generation 3 reached narrative generation after its claim
judgments had been saved. The optional existing-narrative cache read failed
with HTTP status 0; Supabase API logs show no request to
`analysis_report_narratives` during that run, while the surrounding fact-check,
package and stage requests returned HTTP 200. Cloudflare recorded six bounded
fetch attempts with a generic `Error`, so the transport-level cause remains
unknown. The narrative save RPC already enforces a unique key and run fence.
The local follow-up treats only that cache read as best-effort and continues to
validated inputs plus the idempotent save RPC; on a replay this may repeat the
model call but cannot create or overwrite a second narrative artifact. This
mitigation was deployed on 2026-10-11 as Worker version
`207f86c2-c4b4-4ff6-8e00-a7b7467f23a5` (100% traffic). The public endpoint
returned HTTP 200. No new analysis generation was triggered, so this specific
fallback and a complete authenticated Production run remain unverified.

#### Production follow-up (2026-10-11, job `d6e57083-3ea6-42ec-8708-0cc269eaeefe`)

Generation 1 failed during `judge_claims`. Cloudflare recorded five exhausted
Supabase fetches, each with six attempts and `kind=unexpected_error`,
`errorName=Error`, `phase=fetch`; the failed requests were PostgREST RPC POSTs.
Supabase API Gateway had no matching requests, so these calls failed before
reaching its HTTP API. The retained trace does not expose the underlying
transport cause. The Worker already retried unexpected PostgREST fetch errors;
the missing diagnostic was a sanitized code from an exception's nested
`cause`, when the runtime provides one.

The retry adapter now logs only network cause codes from a fixed allowlist,
never arbitrary codes or cause messages. This improves diagnosis and does not
claim to fix an external transport failure. Worker version
`cebb59ae-f89e-419c-90cc-1caa4036d397` was deployed on 2026-10-11; the
Production endpoint HEAD check returned HTTP 200. No new analysis generation
was started, so this failure's recovery and the next cause diagnostic remain
unverified.

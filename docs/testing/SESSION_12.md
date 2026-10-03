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

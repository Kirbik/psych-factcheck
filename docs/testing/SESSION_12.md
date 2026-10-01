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
  “Сопоставление данных” step. Report preparation remains pending.

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
or a no-op implementation. Report generation and report UI remain future work.

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

## Remaining verification

- Run a fresh authenticated upload through fact-check persistence. Existing
  completed jobs are not automatically rerun; deployment and HTTP health do
  not establish full-path workflow success.
- Resolve the Playwright stall and pass full-path E2E before accepting the
  workflow.
- Add expert-reviewed verdict/citation cases before making any judgment-quality
  claim. Current synthetic evals verify contracts, not semantic correctness.
- Confidence is an uncalibrated model output. Citation membership is checked,
  but semantic support between each passage and explanation is not evaluated.

# Session 5 verification — 2026-09-27

Goal: non-AI preparation workflow, durable status, idempotent starts and
retries. No transcription, retrieval, judgment, report or production deployment
was added.

## Checks

- `pnpm lint`: PASS, two pre-existing Next navigation warnings in
  `src/components/preview/history-preview.tsx`.
- `pnpm typecheck`: PASS after refreshing stale generated Next route types
  using `node node_modules/next/dist/bin/next typegen`.
- `pnpm test`: 113 passed, 4 skipped (21 files: 19 passed, 2 skipped).
  The skipped Auth/real-Supabase PostgreSQL suites lack test configuration.
- `pnpm test:e2e`: 10 passed, 5 skipped. Live auth/upload cases require a
  dedicated test environment. Workflow progress/reload/retry uses API mocks.
- `pnpm build`: PASS, including `/api/analysis` and dynamic `/processing`.
- `pnpm build:vinext`: PASS. Initial sandbox run could not write Wrangler's
  external diagnostic log; the permitted rerun completed without that error.
- `pnpm check`: PASS (final lint, typecheck and Vitest run).
- `git diff --check`: PASS.

The first restricted E2E attempt could not download Google Fonts and was
stopped. The network-enabled run exposed an ambiguous test selector (product
alert plus Next route announcer); it was scoped to `main` without weakening
the assertion, then the suite passed. Build also used network access for fonts.

An independent Reviewer found missing byte validation and UI-dependent enqueue.
Both were fixed: bounded signature validation in the worker and an atomic
content-insert/job trigger. An independent Test Engineer added 56 workflow
unit tests. SQL checks use PGlite and actual migration SQL; they do not simulate
real multi-connection contention or prove hosted migrations were applied.

## Visual comparison / DESIGN DEVIATIONS

Inspected production-build screenshots at 1440px desktop and 390px mobile,
plus `docs/design/05-obrabotka-video.png`. No mobile horizontal overflow.

- Header/palette/typography: PNG shows a monochrome header with knowledge/about
  links and sans-serif title; current existing preview uses the warm foundation,
  branded icon, checks/profile links and Lora title. Inherited before Session 5.
- Progress layout: PNG places indicators alongside left-aligned labels with a
  connecting line; existing preview centers labels beneath indicators inside a
  rounded card. Inherited existing styles; Session 5 changes no CSS.
- Copy and state: PNG shows later AI work in progress; the implementation shows
  upload complete and AI stages pending, because only technical preparation is
  implemented. Retry replaces the disabled report action at the same position
  when preparation fails.

The approved Figma URL/source was not supplied. These screenshots establish
readability and behavior, not Figma/Preline visual acceptance. Visual alignment
remains pending and was not expanded into a redesign in this backend session.

## Live Development verification — 2026-09-27

- Verified the configured workflow and Supabase server credentials without
  printing their values. Stored worker credentials as secret Development variables.
- Checked hosted migration history: version `20260926000000` belongs to
  `token_auth`. Renamed the unapplied bucket migration to `20260927090000`.
- Reviewed `db push --dry-run`, then applied bucket and workflow migrations.
  Confirmed private Storage, 104857600-byte limit and MP4/WebM/MOV MIME types.
- Regenerated `src/types/database.ts` using the Supabase CLI against public schema.
- The Development worker's active minute schedule `reconcile-analysis-jobs`
  successfully dispatched an existing 33378943-byte WebM upload after one job
  was manually queued for this pre-migration content.
- Job `266d6de1-5fdd-40b1-9871-1e54244219eb` completed on attempt 1;
  run `run_06ge60ojij269upjqnri8ptk01` returned `{ outcome: "prepared" }`.
  Database stage is `complete`, error is null, and content remains `pending`.
- Repeated dispatch with the same job-generation identity returned the same run.
- Worker build artifacts exposed a tooling gap: ESLint scanned generated runtime
  files. Excluded the generated output directory from ESLint/Prettier; source
  rules remain intact.

## Acceptance still pending

The previous Development runtime proved scheduler/worker/Storage/database
integration for the preparation code. The Cloudflare runtime migration still
needs local and production verification, along with a fresh browser upload,
failure/retry/crash scenarios and Figma acceptance before closing Session 5.
Production uses the existing Worker environment and Wrangler deployment.
See [setup instructions](../architecture/WORKFLOWS.md).

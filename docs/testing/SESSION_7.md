# Session 7 verification — 2026-09-30

## Result

Claim extraction is implemented locally through OpenAI `gpt-4o-mini` and is
connected after transcription in the fenced Cloudflare Workflow. The code
validates source excerpts against transcript segments, derives timestamps on
the server, and persists versioned extraction metadata and claims atomically.

The Session 7 Definition of Done is **not fully met**: `pnpm evals` validates
synthetic fixture shape only and does not measure model extraction quality.
Production migration/deployment and live OpenAI verification are also
outstanding. This is not a release-readiness claim.

## Implementation

- Prompt: `claim-extraction-instructions-v1` in
  `src/server/ai/prompts/claim-extraction-v1.ts`.
- Model: OpenAI `gpt-4o-mini` Responses API with strict structured output;
  response data is parsed as untrusted input and validated locally with Zod.
- The model returns exact source text, claim type, and start/end segment
  indexes. The server verifies the excerpt against those segments and derives
  the stored time range from the transcript.
- One repair request is allowed after malformed or transcript-inconsistent
  output. Inputs over 100,000 characters fail explicitly rather than being
  truncated. At most 100 claims may be returned in one extraction.
- `claim_extractions` records prompt/schema/model versions, including an
  empty result. `claims` stores ordinal, source excerpt, normalized text,
  timestamps, and type. A service-only SQL function writes both atomically;
  retries reuse the extraction marker.
- The analysis pipeline version is now `claim-extraction-v1`; the migration
  upgrades existing job rows, requeues previously completed in-scope jobs,
  preserves completed out-of-scope jobs, and adds the `extract_claims` stage.
  The progress screen reuses its existing claim step without layout or style
  changes.

## Checks

- `pnpm lint`: PASS; two existing Next navigation warnings remain in
  `src/components/preview/history-preview.tsx`.
- `pnpm typecheck`: PASS.
- `pnpm test`: 167 passed, 4 skipped; 25 files passed, 2 environment-gated
  files skipped.
- `pnpm evals`: 4 passed. These check fixture shape only, not model quality.
- `pnpm test:e2e`: 12 passed, 5 skipped; authenticated live Supabase cases
  require the dedicated E2E credentials.
- `pnpm build`: PASS.
- `pnpm build:vinext`: PASS. Wrangler emitted an existing `EPERM` warning
  while attempting to write its debug log outside the workspace; all build
  phases completed.
- `git diff --check`: PASS; Git reported line-ending normalization warnings.
- `pnpm format:check`: FAIL due to formatting warnings in 54 existing files
  across the repository. Changed implementation files were individually
  formatted; this global check is not part of the required gates.

## Limits and next actions

- No live OpenAI extraction was run; no model-quality scores are claimed.
- The Worker, migration, and new workflow binding have not been deployed to
  Production. Rollout must coordinate the migration with Worker deployment so
  a legacy Worker cannot complete a job after it is upgraded.
- A reviewed claim-extraction dataset and actual precision/recall and
  normalization-preservation evaluation are still needed.
- Visual source review used the existing processing reference; status wiring
  now drives the pre-existing “Выделение утверждений” step. No CSS, spacing,
  colors, typography, or layout changed.

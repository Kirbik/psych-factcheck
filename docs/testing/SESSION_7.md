# Session 7 verification — 2026-09-30

## Result

Claim extraction is implemented locally through OpenAI `gpt-4o-mini` and is
connected after transcription in the fenced Cloudflare Workflow. The code
validates source excerpts against transcript segments, derives timestamps on
the server, and persists versioned extraction metadata and claims atomically.

The Session 7 Definition of Done is **not fully met**: `pnpm evals` validates
synthetic fixture shape only and does not measure model extraction quality.
Production migration/deployment are complete, and a Production job later
completed through claim extraction. This confirms a successful workflow run,
not extraction quality or release readiness.

## Production incident and correction — 2026-09-30

Cloudflare instance
`analysis-c5ca7b90-cfc0-4d09-8d36-f10fe16a2057-1` completed screening and
transcription, then failed claim extraction with `CLAIM_OUTPUT_INVALID` after
the model's repair response also failed source validation. The provider now
matches source quote tokens across the transcript despite case and punctuation
differences, recovers segment indexes from the matched transcript text, and
stores the exact transcript excerpt. This correction was deployed as Worker
version `f24f7c46-bbaf-4507-8002-6bd811cb60ab`. A successful retry is still
needed for live verification.

## Follow-up Production failure — 2026-09-30

The job `3bb696f7-2946-424b-b11e-ed5c64d61eaa` passed screening and
transcription but again ended with `CLAIM_OUTPUT_INVALID` after the repair
request. The previous attempt did not persist its validation subtype. The
provider now accepts Russian `ё`/`е` spelling variation while storing the
verbatim transcript excerpt, aligns the model-facing JSON Schema string limits
with local validation, persists the provider error code instead of a generic
workflow error, and logs the validation category plus job ID on future failures
without logging transcript/model text. The UI now gives an actionable message
for this failure code. At the time of this follow-up, a successful retry was
still required; subsequent Production results are recorded below.

## Production workflow and UI update — 2026-09-30

Job `2bab8bce-273d-4e41-ba84-4140e2cf173d` later reached
`status = completed`, `stage = complete`. This confirms that a Production run
passed the claim-extraction workflow stage; it does not measure the quality or
usefulness of the returned claims. The same run's screening record was
`uncertain/sample_unavailable` because MP4 duration metadata was absent, so it
does not verify off-topic rejection.

The current Worker deployment is `fdd311f2-5cda-4d0b-bb3e-c448ccdb6955`.
It includes packet-based audio-duration fallback and the processing-screen
feedback update: active jobs show a reduced-motion-aware activity marker, and
`VIDEO_OUT_OF_SCOPE` is displayed with the shared warning Alert.

Latest verification after the UI feedback change: `pnpm check` passed with 173
tests and two existing lint warnings; the focused screened-out E2E test passed
(1/1); `pnpm evals` passed (4 fixture-shape checks); Next and Vinext production
builds passed; the Worker deployment succeeded and the Production home and
processing routes returned HTTP 200.

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

- One live Production workflow completed through claim extraction, but its
  returned claims have not been reviewed as a labeled quality evaluation.
- Production deployment is complete. Any future migration rollout must still
  coordinate the schema change with Worker deployment so a legacy Worker
  cannot complete a job after it is upgraded.
- A reviewed claim-extraction dataset and actual precision/recall and
  normalization-preservation evaluation are still needed.
- The original Session 7 implementation reused the existing
  “Выделение утверждений” step. The later progress-feedback update reuses the
  processing indicator pattern and shared warning Alert with existing tokens.

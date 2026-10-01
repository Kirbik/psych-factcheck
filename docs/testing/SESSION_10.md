# Session 10 verification — Reranking and Evidence Package

## Result

Implemented in `src/server/evidence/reranking.ts` and connected to the
Cloudflare Workflow:

- A versioned reranker boundary and deterministic implementation combining
  normalized cosine similarity (60%) with normalized-claim term coverage
  (40%), with stable tie-breaking.
- Evidence Package construction capped at five chunks and two per source,
  with identical passage text deduplicated and stored text retained verbatim.
- Source/chunk metadata, retrieval and reranking scores and versions, filters,
  selected chunk IDs, candidate count, and package bounds retained in the
  package.
- Explicit `none`, `limited`, and `multi_source` coverage states and warnings
  for missing or narrow evidence.
- Reranker failures, malformed scores, missing candidate IDs, and altered
  candidate sets fail with bounded error codes. Candidate metadata always
  comes from the validated retrieval result.

The new `build_evidence` stage runs after claim extraction, batches claim
embeddings, and idempotently persists each Evidence Package and its ordered
chunk links. Migration `20261001140000_evidence_packages_v1.sql` and Worker
version `7279e730-7eae-4a78-8126-2a67ebf045ed` were deployed to Production on
2026-10-01. Previously completed jobs are not automatically rerun. This session
does not add verdict judgment or source discovery.

## Checks

- `pnpm lint`: PASS; two existing `next/no-location-assign` warnings remain in
  `src/components/preview/history-preview.tsx`.
- `pnpm typecheck`: PASS.
- `pnpm test`: PASS — 200 passed, 5 skipped; 31 files passed, 3 environment-
  gated files skipped.
- `pnpm evals`: PASS — 3 files and 6 tests. The Session 8 retrieval-v2
  provisional baseline is P@5 0.400; the local Evidence Package eval preserved
  P@5 0.400 on the same three provisional cases.
- `pnpm test:e2e`: INCOMPLETE — the full suite stalled in the browser before
  reporting results; the focused workflow spec also stalled after launching
  all five tests. No E2E pass is claimed.
- `pnpm build`: PASS.
- `pnpm build:vinext`: PASS. Wrangler emitted a log-file permission warning
  during build; deploy ran with the required permission.
- Production migration dry-run: PASS — only
  `20261001140000_evidence_packages_v1.sql` was pending.
- Production migration apply: PASS.
- `pnpm deploy:vinext`: PASS — Worker deployed with the
  `ANALYSIS_WORKFLOW` binding.

The package eval uses all 23 reviewed-seed passages with synthetic zero
similarity scores. It verifies deterministic lexical reranking, diversity,
provenance, and no regression against the offline lexical reference. It does
not exercise the Production pgvector score distribution, measure live semantic
retrieval quality, or provide expert-reviewed relevance labels. The fixture is
small and provisional, so P@5 is not a quality sign-off.

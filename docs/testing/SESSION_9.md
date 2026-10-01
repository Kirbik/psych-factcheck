# Session 9 — Embeddings and Retrieval

## Implementation

- `EmbeddingProvider` now carries provider, model, version, and dimension metadata.
- The OpenAI adapter uses `text-embedding-3-small`, requests 1536 dimensions, batches inputs, restores response order by validated indexes, and rejects malformed or mismatched output.
- `evidence_embeddings` and `claim_embeddings` store versioned vectors, the source-text SHA-256, and dimensions. Retrieval excludes stale chunk vectors.
- `match_evidence_chunks_v1` performs cosine search and returns the evidence passage with its source metadata. It requires the matching embedding model/version, excludes corrected/retracted/withdrawn sources, and filters by language, source type, and publication date. HNSW iterative scans are enabled for filtered searches.
- The current catalog does not contain topic tags, so topic filtering is not supported.

## Verification

- `pnpm lint` — passed; two existing `history-preview.tsx` navigation warnings remain.
- `pnpm typecheck` — passed.
- `pnpm test` — passed: 30 test files, 191 tests; 3 files and 5 tests skipped because external test services are not configured.
- `pnpm test:db` — passed: 2 files and 13 tests; 2 files and 4 tests skipped. `SUPABASE_TEST_DB_URL` is not configured, so the pgvector migration/search integration test did not execute.
- `pnpm evals` — passed: 2 files, 5 tests. Retrieval dataset v2 is provisionally AI-reviewed; the offline lexical P@5 is 0.400 (per-case 0.400, 0.600, 0.200). This is not a score for the semantic retriever and still needs human/expert review.
- `pnpm build` — passed with Next.js 16.3.5.
- `pnpm format:check` — repository-wide check reports pre-existing formatting violations across unrelated files; all changed TypeScript, JSON, and Markdown files were formatted. The SQL migration is not handled by the configured Prettier parser.

## Production verification — 2026-10-01

- Applied `20261001120000_embeddings_retrieval_v1.sql` to the linked Production project. A dry-run confirmed it was the only pending migration.
- The initial `pnpm evidence:embed` run wrote 23 evidence chunk embeddings. The later v2 evaluation reused all 23 existing vectors and wrote no new vectors.
- Live semantic search on retrieval dataset v2 completed for all three cases. Mean P@5 was 0.400 (per-case 0.400, 0.600, 0.200).
- The local pgvector integration test remains unexecuted because `SUPABASE_TEST_DB_URL` is not configured; the Production migration and live search were verified directly.

The relevance fixture is small and has not been human/expert-reviewed. Its score is an initial operational baseline, not a quality sign-off or scientific ground truth.

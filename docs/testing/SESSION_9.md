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
- `pnpm evals` — passed: 2 files, 5 tests. The offline lexical baseline is P@5 0.467 across three initial, not-yet-expert-reviewed relevance queries (per-case 0.400, 0.600, 0.400). This is not a score for the semantic retriever.
- `pnpm build` — passed with Next.js 16.3.5.
- `pnpm format:check` — repository-wide check reports pre-existing formatting violations across unrelated files; all changed TypeScript, JSON, and Markdown files were formatted. The SQL migration is not handled by the configured Prettier parser.

## Remaining verification

The Production schema readback on 2026-10-01 returned `PGRST205` for both embedding tables and `PGRST202` for the search RPC, confirming Session 9 is not deployed. The migration and live semantic P@5 have not been verified because the environment has no Supabase CLI/login token and no OpenAI API key. `pnpm evidence:embed` is now prepared to embed changed chunks and run the three-case semantic P@5 against the configured target, but requires an exact target project ref and explicit confirmation token. It also requires the Session 9 migration to be applied first.

Applying the migration and writing vectors changes Production schema/data and incurs OpenAI API usage. Do not run the migration or `pnpm evidence:embed` until those actions are explicitly approved. The current relevance fixture is small and has not been expert-reviewed; its scores are not scientific ground truth.

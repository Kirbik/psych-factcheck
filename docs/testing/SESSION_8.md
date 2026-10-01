# Session 8 verification — Evidence Base v0

## Result

Implemented locally:

- `sources` and `evidence_chunks` schema with stable DOI/chunk keys, license and
  publication provenance, immutable source relationships, content hashes, and
  authenticated read-only RLS.
- A transaction-scoped service-role import function and explicit
  `pnpm evidence:seed` command. The seed is validated before import, repeatable,
  and preserves curator-set non-active source status.
- A reviewed manifest of 10 publications and 23 concise verbatim English
  passages with section locators. One agreed SAGE article is metadata-only
  because its CC BY-NC 4.0 license does not permit general commercial reuse.
- Query repository methods for active sources, DOI lookup, and source passages.

The migration and seed have **not** been applied to Production. A seed command
attempt returned `fetch failed` before receiving a database response; no import
was confirmed. The command now requires an explicit target confirmation token.

## Checks

- `pnpm lint`: PASS; two pre-existing `next/no-location-assign` warnings remain
  in `src/components/preview/history-preview.tsx`.
- `pnpm typecheck`: PASS after regenerating stale Next route types with
  `node node_modules/next/dist/bin/next typegen`.
- `pnpm test`: PASS — 181 passed, 4 skipped; 27 files passed, 2 environment-
  gated files skipped.
- Targeted Prettier check on changed TypeScript, JavaScript, JSON, and Markdown:
  PASS. The SQL migration was excluded because no SQL Prettier parser is
  installed.
- `git diff --check`: PASS; Git emitted line-ending normalization warnings.

No workflow, AI logic, or UI behavior changed, so E2E, eval, and production
build checks were not applicable.

## Limits and manual action

- Evidence retrieval, embeddings, pgvector, reranking, verdicts, and reports
  remain unimplemented and belong to later sessions.
- Source and chunk reads require an authenticated Supabase session. Seed writes
  require the service-role credential and explicit confirmation.
- The local PGlite test applies the migration and exercises transaction,
  content-hash, null-input, role-grant, and catalog-read behavior; it does not
  verify hosted Supabase permissions or connectivity.
- Apply the reviewed migration and run `pnpm evidence:seed` only after checking
  the configured Supabase URL and service-role target.

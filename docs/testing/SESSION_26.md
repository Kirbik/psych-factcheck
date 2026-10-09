# Session 26 — Remove local RAG

## Scope

Remove the shared scientific catalog, embedding adapters/scripts, vector RPC use
and seed imports. Preserve extracted claims, judgments, citations, narratives and
report history. Public Europe PMC/Crossref discovery remains; audit passages are
saved only in owner-scoped packages.

## Implementation

- Versioned public-search snapshots and rights-gated bounded excerpt retention.
- Package schema v2; no embeddings in new traces; historical package read support.
- Report citations resolve via exact selected judgment package items. A historical
  narrative keeps its original judgment even when newer packages exist.
- Retirement migration preserves cited source metadata and original rights/
  provenance, then changes foreign keys before dropping shared catalog/vector
  storage and RPCs. Claims, saved judgments and original package payloads remain.
- Corpus-specific seed/embedding/vector tests and evals are removed because their
  runtime functionality is retired. Replacement mock API, SQL migration, fencing,
  citation membership and persistence tests maintain checks for the active path.
- No new dependencies or UI/transcription/claim extraction changes.

## Checks actually run

- `pnpm check`: passed lint, typecheck and tests (258 passed, 4 environment-gated
  skips). `pnpm lint`, `pnpm test` were also run independently.
- `pnpm evals`: 8 synthetic contract checks passed.
- `pnpm test:e2e --reporter=line`: 13 passed, 6 credential/environment-gated skips.
- `pnpm build` and `pnpm build:vinext`: passed.
- `git diff --check`: passed; `git diff --stat` reviewed; no commits.
- Prettier check of all changed/new supported files passed.
- Global `pnpm format:check` failed on 47 unchanged files. Read comparison against
  HEAD confirmed all 47 are pre-existing; no unrelated formatting rewrite was made.

The initial Next build exposed the missing package-item TypeScript table contract;
it was added and subsequent builds/typecheck passed. A check immediately after
Vinext build failed because Vinext regenerates incomplete `.next` route types.
Next build restored those generated types; final `pnpm check` passed without
disabling checks or changing TypeScript settings.

## Limits and manual rollout

Migration and Worker have not been applied/deployed to Production in this session.
No live scientific API, authenticated Production analysis or model-quality checks
were run. Skipped Supabase/auth/upload tests need the dedicated test environment.

PGlite applies the actual retirement/application SQL with structural stand-ins for
vector tables/RPCs; it does not verify real pgvector DDL, hosted service behavior
or concurrent database connections. Provider and judgment calls are controlled
mocks. Europe PMC/Crossref coverage and licensed paragraph relevance remain limited;
expert-reviewed golden cases are required before claiming model quality.

Back up the database/catalog, pause intake/dispatch, drain active runs, migrate and
deploy compatible code together, resume and verify old reports plus a fresh
authenticated analysis. Earlier SQL migrations remain historical upgrade steps.
See [Evidence storage](../architecture/EVIDENCE_BASE.md).

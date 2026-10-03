# Test Strategy

Tests use real behavior at the smallest practical boundary. Unit tests stay deterministic. Supabase integration suites run only against an explicitly configured local test project/database; no production project should be used as a test target.

## Current coverage

- **Static:** TypeScript strict check, ESLint, Prettier.
- **Unit:** auth action/validation, Supabase configuration, upload validation, auth proxy behavior, UI components, and preview screens.
- **Integration:** Supabase Auth session/profile lifecycle and PostgreSQL schema/RLS tests. Each suite is environment-gated and skips when its required test service variables are absent.
- **E2E:** Playwright covers the token-auth entry/registration interactions and UI preview routes. Authenticated registration, login/logout, protected route, and video-upload flows run only when a dedicated Supabase test environment and test token are configured.
- **AI evals:** synthetic fixture checks plus a deterministic lexical P@5 baseline over three provisional AI-reviewed query cases. Session 9 also recorded live Production semantic retrieval at P@5 0.400; this small set is not human/expert-reviewed and does not establish retrieval or verdict quality. See [AI eval plan](AI_EVALS.md).
- **Session 11 judgment:** unit tests cover strict verdict/confidence validation, citation membership, evidence-required verdicts, malformed provider output, and prompt-injection boundaries. PGlite applies the persistence migration to verify immutable idempotency, package-bound citations, and owner-readable RLS. Synthetic contract evals reject fabricated citations but do not judge semantic evidence/verdict agreement; an expert-reviewed golden set is still required.
- **Session 13 report:** component tests cover persisted report fields, unique source counts, status distribution, keyboard tab switching, and empty/loading states. The authenticated browser flow remains to be verified.
- **Report badge criteria:** mocked repository tests distinguish insufficient evidence with resolved judgment citations (disputed) from metadata-only or uncited results (not found). They preserve contradiction, supported and unverifiable mappings and reject broken source links. The saved scientific verdict is unchanged.
- **Session 25 report narrative:** deterministic provider tests validate exact claim membership and the stored payload schema; workflow tests verify narrative persistence happens before completion; PGlite applies the owner-readable, service-write-only migration. These checks do not establish that subjective comments or overall conclusions are semantically correct. Expert-reviewed golden cases remain required.
- **Historical opinion examples:** mocked narrative tests cover fixed book attribution, rejection of unknown/duplicate/unbound reference IDs and model-authored attribution, empty claims, two-example length bounds, old payload compatibility, audit metadata persistence and idempotent reuse. Runtime tests make no book or OpenAI requests. Semantic relevance and unsupported author mentions in free model prose still require expert-reviewed cases.
- **Session 12 full pipeline:** unit tests cover per-claim durable-step orchestration, saved-result skipping, partial resume, empty claims, missing/mismatched packages, and stale stage fences. PGlite verifies the run-fenced save path rejects stale run IDs. A fresh authenticated Production analysis completed at `stage = complete` in generation 2; the browser Playwright run is still incomplete because it started 17 tests, stalled without results, and was interrupted. See [Session 12 verification](SESSION_12.md).
- **Session 5 workflow:** unit tests cover dispatch/reconciliation and retry races; PGlite runs the actual workflow migration in isolated PostgreSQL for RLS, RPC grants, transitions and fencing; API tests verify ownership and safe responses; Playwright mocks the workflow API for progress/reload/retry. These do not verify hosted Cloudflare/Supabase connectivity. See [Session 5 QA](SESSION_5.md).
- **Session 8 Evidence Base:** Zod tests validate the curated seed and stable identifiers; PGlite applies the actual migration and verifies transactional imports, idempotency, foreign-key integrity, status preservation, and catalog RLS. These tests do not apply the migration or seed to Production. See [Session 8 verification](SESSION_8.md).
- **Sessions 9–10 retrieval:** unit/eval coverage checks embedding/search validation, deterministic reranking, package provenance/coverage, and workflow persistence/idempotency. The actual retrieval and Evidence Package migration plus Worker are deployed to Production; a fresh authenticated analysis has now completed the full path. The most recent Playwright attempt for the changed progress flow stalled without reporting results. See [Session 9](SESSION_9.md) and [Session 10](SESSION_10.md).

Coverage is not proof that an unconfigured external service or skipped flow works. Consult [Supabase foundation](../architecture/SUPABASE.md) and [Authentication](../architecture/AUTH.md) for exact integration variables.

## Level 1 — Static checks

TypeScript strict mode validates contracts; ESLint checks code; Prettier enforces formatting. Commands:

```bash
pnpm lint
pnpm typecheck
pnpm format:check
```

## Level 2 — Unit tests

Vitest covers pure functions, Zod validators, transforms, domain rules, auth behavior, and UI components. Current examples include auth input/action behavior, public Supabase config, video container validation, proxy redirects, and component rendering. Add edge cases for malformed, empty, oversized, unauthorized, and failure inputs when relevant.

```bash
pnpm test:unit
```

## Level 3 — Integration tests

The current suites verify Supabase Auth/profile lifecycle and real PostgreSQL migration/RLS behavior. `SUPABASE_TEST_URL` plus `SUPABASE_TEST_ANON_KEY` enable Auth integration; `SUPABASE_TEST_DB_URL` enables PostgreSQL/RLS integration. Use a local disposable Supabase stack. Tests skip when configuration is absent and do not silently substitute mocks. The pgvector migration/search integration test requires `SUPABASE_TEST_DB_URL`; it was skipped in Session 9. Session 10's package persistence integration test uses PGlite; Production migrations and retrieval were verified separately. Future integrations include Storage policy behavior, live provider adapters, and billing adapters.

```bash
pnpm test:integration
pnpm test:db
```

## Level 4 — E2E tests

Playwright uses the stable Google Chrome channel. Install Chrome locally; CI may install the matching Playwright browser. The current suite covers public token-auth UI states and prototype routes. Supabase-backed signup and protected-route coverage needs the public URL/key plus the server service-role key. Existing-user login/logout/upload additionally need `E2E_SUPABASE_TOKEN` for a dedicated confirmed test user. Missing credentials cause explicit skips.

The current E2E suite mocks persisted analysis progress and retry behavior; authenticated live upload still requires the dedicated Supabase test environment. The root-level prototype screens are not substitutes for hosted integration coverage.

```bash
pnpm test:e2e
```

## Level 5 — AI evals

The current `pnpm evals` command checks synthetic output contracts and computes an offline lexical retrieval baseline; it does not call a model or establish extraction, semantic citation support, or fact-check quality. `pnpm evidence:embed` separately runs live semantic retrieval and may write vectors or incur OpenAI usage, so its Production target must be verified before execution. Future versioned evals require expert-reviewed cases for claim extraction/normalization, retrieval relevance, verdict quality, citation accuracy, unsupported claims, hallucinations, and correlation/causation errors. See [AI eval plan](AI_EVALS.md).

```bash
pnpm evals
```

## Required workflow

- After any code change: run `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
- After user-flow changes: run applicable `pnpm test:e2e` cases.
- After AI logic changes: run meaningful AI evals; the current shape-only fixture check is insufficient as a quality gate.
- After production build/config changes: run `pnpm build`; evaluate `pnpm build:vinext` separately when changing the Cloudflare target.
- Before release: run all relevant suites with required environment configuration and report skipped tests explicitly.

No script may be a fake unconditional success. A test layer that has no applicable cases must report that honestly.

## Bug-fix protocol

1. Reproduce the bug.
2. Create a regression test when practical.
3. Confirm the test fails.
4. Fix the implementation.
5. Confirm the regression test passes.
6. Run related tests.
7. Run `pnpm check`.

Never fix a product bug only by editing or weakening the test.

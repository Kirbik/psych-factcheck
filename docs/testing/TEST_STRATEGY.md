# Test Strategy

Tests use real behavior at the smallest practical boundary. Unit tests stay deterministic. Supabase integration suites run only against an explicitly configured local test project/database; no production project should be used as a test target.

## Current coverage

- **Static:** TypeScript strict check, ESLint, Prettier.
- **Unit:** auth action/validation, Supabase configuration, upload validation, auth proxy behavior, UI components, and preview screens.
- **Integration:** Supabase Auth session/profile lifecycle and PostgreSQL schema/RLS tests. Each suite is environment-gated and skips when its required test service variables are absent.
- **E2E:** Playwright covers the token-auth entry/registration interactions and UI preview routes. Authenticated registration, login/logout, protected route, and video-upload flows run only when a dedicated Supabase test environment and test token are configured.
- **AI evals:** currently one synthetic fixture schema check only; there are no provider calls, retrieval evaluations, or verdict-quality scores.

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

The current suites verify Supabase Auth/profile lifecycle and real PostgreSQL migration/RLS behavior. `SUPABASE_TEST_URL` plus `SUPABASE_TEST_ANON_KEY` enable Auth integration; `SUPABASE_TEST_DB_URL` enables PostgreSQL/RLS integration. Use a local disposable Supabase stack. Tests skip when configuration is absent and do not silently substitute mocks. Future integrations include repositories, Storage policy behavior, vector retrieval, provider adapters, background workflows, and billing adapters.

```bash
pnpm test:integration
pnpm test:db
```

## Level 4 — E2E tests

Playwright uses the stable Google Chrome channel. Install Chrome locally; CI may install the matching Playwright browser. The current suite covers public token-auth UI states and prototype routes. Supabase-backed signup and protected-route coverage needs the public URL/key plus the server service-role key. Existing-user login/logout/upload additionally need `E2E_SUPABASE_TOKEN` for a dedicated confirmed test user. Missing credentials cause explicit skips.

Future critical flows include actual upload persistence, analysis start/progress, report viewing, and history. The `/ui-preview/*` screens are not substitutes for those flows.

```bash
pnpm test:e2e
```

## Level 5 — AI evals

The current `pnpm evals` command checks the Zod shape of a single synthetic fixture. It does not call a model or establish fact-check accuracy. Future versioned evals will assess claim extraction/normalization, retrieval relevance, verdict quality, citation accuracy, unsupported claims, hallucinations, and correlation/causation errors. See [AI eval plan](AI_EVALS.md).

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

# Test Strategy

Testing follows risk and boundary layers. Tests should be deterministic by default, use representative data, and never call paid/external APIs unless an explicitly isolated contract suite requires it.

## Level 1 — Static checks

TypeScript strict mode catches invalid contracts; ESLint enforces code quality; Prettier provides deterministic formatting. `pnpm lint`, `pnpm typecheck`, and `pnpm format:check` are independent so failures stay diagnosable.

## Level 2 — Unit tests

Vitest covers pure functions, Zod validators, transforms, domain rules, entitlement calculations, verdict mapping, and UI components with meaningful behavior. Prefer behavior-focused assertions and boundary cases over snapshots.

## Level 3 — Integration tests

Integration suites cover repositories, Supabase/RLS, vector retrieval, provider adapters, Trigger.dev workflow boundaries, and billing adapters. External APIs are mocked by default at the provider boundary. Database tests must isolate data and verify ownership/authorization, idempotency, failures, and cleanup. Session 2 adds `tests/integration/database/rls.test.ts`, which runs against real PostgreSQL with Supabase roles and JWT claims when `SUPABASE_TEST_DB_URL` is configured. It verifies migration artifacts, profile creation, owner access, cross-user denial, and anonymous denial; it skips rather than simulates a database when that explicit local URL is absent. See [Supabase foundation](../architecture/SUPABASE.md).

## Level 4 — E2E tests

Playwright covers critical browser flows: signup, login, upload, analysis start/progress, report viewing, and history. After monetization it also covers checkout, limit enforcement, upgrade, and cancellation. Keep a small high-value Chromium suite first; add browsers when compatibility requirements justify it.

## Level 5 — AI evals

Versioned evals assess claim extraction/normalization, retrieval quality, evidence relevance, verdict quality, citation correctness, hallucinations, unsupported claims, and correlation/causation mistakes. AI evals supplement—not replace—deterministic tests. See `AI_EVALS.md`.

## Commands and gates

- During development: targeted test plus `pnpm check`.
- User-flow change: add/run `pnpm test:e2e`.
- AI change: add/run `pnpm evals`.
- Production-impacting change: run `pnpm build`.
- Release: lint, typecheck, tests, build, applicable E2E/evals, and independent review.

No script may be a fake unconditional success. A layer without tests must say so using the runner's explicit no-tests behavior, then gain real cases as soon as the relevant boundary exists.

## Bug-fix protocol

1. Reproduce the bug.
2. Create a regression test when practical.
3. Confirm the test fails.
4. Fix the implementation.
5. Confirm the regression test passes.
6. Run related tests.
7. Run `pnpm check`.

Never fix a product bug only by editing or weakening the test.

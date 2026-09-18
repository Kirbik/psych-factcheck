# Psych Factcheck

An MVP in development for evidence-grounded fact-checking of psychological video content. The system will transcribe one uploaded video, extract claims, retrieve scientific evidence, make evidence-bound judgments, and present a traceable report. The repository currently contains only the project foundation—no external services or product workflows are connected.

## Stack

Next.js App Router, React, strict TypeScript, Zod, Supabase PostgreSQL/Auth client, pnpm, ESLint, Prettier, Vitest, and Playwright. Trigger.dev and AI/provider adapters are introduced in later sessions.

## Prerequisites

- Node.js 22 or newer
- pnpm 11 or newer
- Git

## Install and run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Commands

```bash
pnpm dev               # local Next.js server
pnpm build             # production build
pnpm lint              # ESLint
pnpm format:check      # Prettier check
pnpm typecheck         # strict TypeScript check
pnpm test              # all unit and integration tests currently present
pnpm test:unit         # unit tests
pnpm test:integration  # integration test directory; currently empty
pnpm test:db           # actual PostgreSQL schema/RLS integration tests; needs local Supabase
pnpm test:e2e          # Playwright smoke test
pnpm evals             # validates the synthetic eval fixture
pnpm check             # lint + typecheck + all current Vitest tests
```

The local E2E configuration uses the stable Google Chrome channel. Install Chrome locally, or install the corresponding Playwright browser in CI with `pnpm exec playwright install chrome`.

## Environment

Copy `.env.example` to `.env.local` before using a Supabase client. Every value in the example is a placeholder. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are intentionally browser-visible project values. `SUPABASE_SERVICE_ROLE_KEY` is server-only: never give it a `NEXT_PUBLIC_` prefix or import the admin client from browser code.

Supabase configuration, migrations, type generation, RLS, local setup, hosted setup, and the database-test command are documented in [Supabase foundation](docs/architecture/SUPABASE.md). Email/password authentication, protected routes, and its local test configuration are documented in [Authentication](docs/architecture/AUTH.md).

## Testing status

The foundation includes a unit rendering smoke test, a browser smoke test, a schema check for a synthetic eval fixture, and integration tests that exercise PostgreSQL RLS when a local Supabase database URL is supplied.

## Deployment concept

The web application will deploy to Vercel. Later, Supabase will host Auth, private Storage, PostgreSQL, and pgvector; Trigger.dev will execute background analysis. No external service is connected yet.

## Documentation

- [Architecture](ARCHITECTURE.md)
- [MVP](docs/product/MVP.md)
- [Fact-checking rules](docs/product/FACT_CHECKING_RULES.md)
- [Development sessions](docs/product/DEVELOPMENT_SESSIONS.md)
- [Data model](docs/architecture/DATA_MODEL.md)
- [Supabase foundation](docs/architecture/SUPABASE.md)
- [Authentication](docs/architecture/AUTH.md)
- [AI pipeline](docs/architecture/AI_PIPELINE.md)
- [Billing](docs/architecture/BILLING.md)
- [Test strategy](docs/testing/TEST_STRATEGY.md)
- [AI evals](docs/testing/AI_EVALS.md)
- [Codex QA workflow](docs/testing/CODEX_QA_WORKFLOW.md)

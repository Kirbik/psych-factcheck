# Psych Factcheck

An MVP in development for evidence-grounded fact-checking of psychological video content. The current application includes server-generated token registration/login, protected user pages, a Supabase PostgreSQL/Auth foundation, and one-video upload to private Supabase Storage. Transcription, claim extraction, evidence retrieval, judgment, report persistence, and analysis workflows are not connected yet.

## Stack

Next.js App Router, React, strict TypeScript, Zod, Supabase PostgreSQL/Auth/Storage, `@supabase/ssr`, pnpm, ESLint, Prettier, Vitest, and Playwright. The repo also contains an experimental Vinext/Vite/Cloudflare Workers build path. Trigger.dev and real AI/transcription/embedding providers are not connected.

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
pnpm test              # all unit and integration tests; environment-gated suites may skip
pnpm test:unit         # unit tests
pnpm test:integration  # Supabase Auth and PostgreSQL RLS integration tests
pnpm test:db           # PostgreSQL schema/RLS tests; needs local Supabase and SUPABASE_TEST_DB_URL
pnpm test:e2e          # Playwright UI smoke and configured auth/upload flows
pnpm evals             # synthetic fixture-shape check only; no AI evaluation pipeline yet
pnpm check             # lint + typecheck + all current Vitest tests
pnpm dev:vinext        # experimental Vinext/Vite development server on port 3001
pnpm build:vinext      # experimental Cloudflare/Vinext build
pnpm start:vinext      # serve the Vinext build locally with Wrangler
pnpm deploy:vinext     # deploy the Vinext build through Cloudflare tooling
```

The local E2E configuration uses the stable Google Chrome channel. Install Chrome locally, or install the corresponding Playwright browser in CI with `pnpm exec playwright install chrome`.

## Environment

Copy `.env.example` to `.env.local` before using Supabase-backed routes. Every value in the example is a placeholder. Set `NEXT_PUBLIC_SUPABASE_URL` and either `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; these are browser-visible, RLS-limited project keys. `SUPABASE_SERVICE_ROLE_KEY` is server-only: never give it a `NEXT_PUBLIC_` prefix or import the admin client from browser code. Optional integration and E2E variables are documented in [Supabase foundation](docs/architecture/SUPABASE.md) and [Authentication](docs/architecture/AUTH.md).

Supabase configuration, migrations, type generation, RLS, local setup, hosted setup, and database-test commands are documented in [Supabase foundation](docs/architecture/SUPABASE.md). Generated-token authentication, protected routes, and auth test configuration are documented in [Authentication](docs/architecture/AUTH.md).

## Testing status

The suite includes unit tests for auth validation/actions, Supabase configuration, upload validation, and UI components; Supabase Auth and PostgreSQL/RLS integration suites that require explicit local test configuration; and Playwright tests for login/registration UI, preview pages, and optionally configured auth/upload flows. Without test service variables, only those dependent cases skip. `pnpm evals` currently validates one synthetic fixture's shape; it does not evaluate an AI pipeline. Synthetic examples are not medical ground truth.

## Deployment concept

The standard Next.js scripts (`dev`, `build`, `start`) remain available. A separate Vinext/Vite configuration and Wrangler worker provide an experimental Cloudflare Workers deployment path; assess compatibility and perform a configured build before relying on it for production. Supabase Auth, PostgreSQL, and private Storage are already used by server routes. pgvector and Trigger.dev remain future work. Do not deploy from this README without reviewing the target environment and Wrangler bindings/secrets.

## Documentation

- [Architecture](ARCHITECTURE.md)
- [UI foundation](UI_FOUNDATION.md)
- [Design screens and prototype status](docs/design/README.md)
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

# Development Sessions

Use one session per bounded objective. Do not begin a later session until the user accepts the current one. Every session starts with `AGENTS.md`, `ARCHITECTURE.md`, relevant documents, tests, and `git status`, and ends with actual check results plus `git diff --stat`.

## Repository progress (2026-09-26)

The repository contains implementation work through Session 4: foundation/tooling, Supabase schema and clients, token-based authentication, and validated private video upload. These sessions have implementation artifacts in the current tree; this status is not a claim that every environment-gated test passed or that the MVP is release-ready. Session 5 is the next planned development goal. No analysis workflow, transcription, AI, Evidence Base, or report persistence is connected.

## Session 0 — Foundation

**Status:** Implemented. The project has the Next.js/TypeScript/pnpm tooling, documentation, provider contracts, tests, and initial smoke coverage. This records implementation status, not a release audit.

- **Goal:** Establish architecture, documentation, project rules, and executable quality tooling.
- **Why:** Future Codex sessions need a safe, shared operating baseline.
- **Scope:** Next.js/TypeScript App Router skeleton, pnpm, lint/format, Vitest, Playwright, smoke tests, provider contracts, directories, and documentation.
- **Out of scope:** Supabase, Trigger.dev, real providers, product workflows, credentials.
- **Expected files:** Root configs/docs, `src/app`, provider contracts, `tests`, `evals`, `docs`.
- **Acceptance criteria:** Strict TypeScript; placeholder-only env example; all requested commands exist and are honest.
- **Required tests:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and E2E where environment permits.
- **Suggested Codex model:** Sol for architecture, Terra for implementation, Luna for doc cleanup.
- **QA requirements:** Self-check against the Session 0 brief and report actual results.
- **Definition of Done:** Clean required gates and no external/product integration.

## Session 1 — Project Skeleton

**Status:** Implemented. App Router structure, lint/format/typecheck, Vitest, Playwright, smoke coverage, and package scripts are present. Recheck current toolchain compatibility as part of future maintenance.

- **Goal:** Audit and refine the executable application skeleton without adding features.
- **Why:** Confirm current Next.js/tooling conventions and developer ergonomics before infrastructure work.
- **Scope:** Route/layout conventions, config cleanup, CI-ready scripts, test organization, baseline accessibility/metadata.
- **Out of scope:** Supabase, auth, upload, background or AI behavior.
- **Expected files:** `src/app`, root configs, tests, README updates.
- **Acceptance criteria:** Local dev/build are deterministic; scripts and docs agree; no placeholder production behavior.
- **Required tests:** lint, typecheck, unit, E2E smoke, build.
- **Suggested Codex model:** Terra.
- **QA requirements:** Independent Reviewer for configuration and maintainability.
- **Definition of Done:** Release-like skeleton passes all gates and Session 2 inputs are explicit.

## Session 2 — Supabase Foundation

**Status:** Implemented. Supabase client boundaries, migrations, generated DB contract, initial RLS policies, and environment-gated Auth/real-PostgreSQL tests exist. Current schema has subsequently expanded with video and token-auth migrations.

- **Goal:** Add typed Supabase connections, migrations, initial schema, and RLS foundations.
- **Why:** Persistence and ownership precede user features.
- **Scope:** Local/server/browser client boundaries, migrations for initial entities, generated types workflow, RLS tests.
- **Out of scope:** Auth UI, upload UI, AI, Trigger.dev, billing.
- **Expected files:** `src/server/db`, Supabase config/migrations, integration tests, env docs.
- **Acceptance criteria:** Keys stay in correct boundary; user-owned tables deny cross-user access by default.
- **Required tests:** lint, typecheck, unit, database integration/RLS, build.
- **Suggested Codex model:** Terra.
- **QA requirements:** Reviewer plus Test Engineer focused on RLS and configuration failures.
- **Definition of Done:** Reproducible migration and verified least-privilege baseline.

## Session 3 — Authentication

- **Goal:** Implement signup, login, logout, sessions, and protected routes.
- **Why:** Ownership requires a reliable identity boundary.
- **Scope:** Supabase Auth flows, validation, server-side session checks, minimal auth UI. The implemented product uses generated high-entropy access tokens and one-time recovery codes rather than user-chosen email/password credentials.
- **Out of scope:** Social auth, public/support-assisted recovery, token rotation, upload, AI.
- **Expected files:** `src/features/auth`, auth routes/actions, middleware if justified, E2E tests.
- **Acceptance criteria:** Unauthorized access is blocked; errors do not leak sensitive details; raw access/recovery codes are not stored in the token lookup tables.
- **Required tests:** lint, typecheck, unit/integration, auth E2E, build.
- **Suggested Codex model:** Terra.
- **QA requirements:** Reviewer and authorization-focused Test Engineer.
- **Definition of Done:** Critical auth flows work and ownership context is available server-side.

**Status:** Implemented. Token generation, signup, sign-in, sign-out, cookie session refresh, server claim validation, and one-time recovery code display exist. The recovery screen is preview-only; no recovery operation exists.

## Session 4 — Video Upload

- **Goal:** Securely upload one video and persist `content_items`.
- **Why:** Video is the input boundary for analysis.
- **Scope:** Private Storage bucket/policies, type/size validation, upload state, ownership checks.
- **Out of scope:** Transcription, job orchestration, multi-upload, external content.
- **Expected files:** `src/features/analysis`, `src/server/storage`, migrations/policies, tests.
- **Acceptance criteria:** Invalid/unowned files are rejected and valid uploads create one owned record. Current supported types are MP4, WebM, and MOV up to 100 MiB; successful items remain `pending` until a future workflow updates them.
- **Required tests:** validator unit, Storage/RLS integration, upload E2E, build.
- **Suggested Codex model:** Terra.
- **QA requirements:** Security-oriented Reviewer and failure-case Test Engineer.
- **Definition of Done:** One private untrusted video can be uploaded safely.

**Status:** Implemented. The authenticated upload route validates type/container/size, writes to the private `videos` bucket, persists an owner-scoped content row, and uses a per-user upload ID for idempotency. It does not start analysis or create an `analysis_jobs` record.

## Session 5 — Background Workflow

**Status:** Planned; next session. Start only after the user approves this development goal.

- **Goal:** Add an idempotent Trigger.dev analysis workflow without AI.
- **Why:** Long-running work must not depend on an HTTP request.
- **Scope:** Job state machine, enqueue action, durable status/progress, retry-safe stub stages that represent orchestration only.
- **Out of scope:** Fake AI outputs, transcription, retrieval, report.
- **Expected files:** `src/server/workflows`, `analysis_jobs` migration/repository, status UI/tests.
- **Acceptance criteria:** Duplicate starts/retries do not duplicate jobs; failure states are actionable.
- **Required tests:** state-machine unit, workflow/repository integration, progress E2E, build.
- **Suggested Codex model:** Terra.
- **QA requirements:** Reviewer for idempotency/races; Test Engineer for retries/timeouts.
- **Definition of Done:** Non-AI workflow completes and persists deterministic states.

## Session 6 — Transcription

- **Goal:** Implement `TranscriptionProvider` adapter and timestamped transcript persistence.
- **Why:** Claims require auditable source text and timing.
- **Scope:** One selected provider adapter, Zod validation, errors/timeouts, transcript repository/workflow stage.
- **Out of scope:** Claim extraction, multiple providers in UI, judgment.
- **Expected files:** `src/server/ai`, transcripts migration/repository, workflow/tests.
- **Acceptance criteria:** Provider data is validated and segments map faithfully with timestamps.
- **Required tests:** adapter unit/contract, malformed/timeout integration, workflow tests, build.
- **Suggested Codex model:** Terra.
- **QA requirements:** Reviewer plus provider-failure Test Engineer.
- **Definition of Done:** A real uploaded video yields a validated persisted transcript through the provider boundary.

## Session 7 — Claim Extraction

- **Goal:** Extract, normalize, and classify claims via `LLMProvider` structured output.
- **Why:** Retrieval needs faithful standalone propositions.
- **Scope:** Prompt/schema/versioning, Zod validation, claim persistence, bounded repair/error behavior.
- **Out of scope:** Retrieval, verdicts, using model knowledge as evidence.
- **Expected files:** AI schemas/prompts/provider adapter, claims repository, tests/evals.
- **Acceptance criteria:** Original text/timestamp remain traceable; normalization does not strengthen claims.
- **Required tests:** schema/domain unit, adapter/workflow integration, claim evals, build.
- **Suggested Codex model:** Sol for design; Terra for implementation.
- **QA requirements:** Reviewer, Test Engineer, independent AI QA.
- **Definition of Done:** Versioned validated claims are persisted with measurable extraction quality.

## Session 8 — Evidence Base v0

- **Goal:** Create a small traceable source/chunk store and controlled import mechanism.
- **Why:** Fact checking requires real evidence, not model memory.
- **Scope:** `sources`, `evidence_chunks`, provenance/status fields, idempotent validated seed/import.
- **Out of scope:** Production-scale corpus, live web search, embeddings/retrieval verdicts.
- **Expected files:** migrations, evidence repositories/importer, curated sample metadata, tests.
- **Acceptance criteria:** Every chunk resolves to a real source and imports are reproducible.
- **Required tests:** validation unit, repository/import integration, citation integrity checks.
- **Suggested Codex model:** Terra.
- **QA requirements:** Reviewer for provenance/licensing and Test Engineer for malformed/duplicate data.
- **Definition of Done:** Auditable Evidence Base v0 is queryable without invented sources.

## Session 9 — Embeddings + Retrieval

- **Goal:** Embed claims/chunks and retrieve relevant candidates with pgvector.
- **Why:** Scalable evidence selection needs semantic candidate search.
- **Scope:** `EmbeddingProvider`, vector schema/index, version/dimension checks, similarity query, metadata filters.
- **Out of scope:** Reranking and verdict judgment.
- **Expected files:** embedding adapter, evidence repository/search, migrations, retrieval evals.
- **Acceptance criteria:** Model/version mismatches fail safely; results retain provenance and filter rules.
- **Required tests:** adapter/schema unit, pgvector integration, retrieval precision@k baseline, build.
- **Suggested Codex model:** Sol for retrieval design; Terra for implementation.
- **QA requirements:** Reviewer, Test Engineer, AI QA for relevance/injection cases.
- **Definition of Done:** Versioned retrieval returns traceable candidates with a recorded baseline.

## Session 10 — Reranking

- **Goal:** Select the best non-duplicative evidence from retrieved candidates.
- **Why:** Similarity alone does not guarantee direct evidentiary relevance.
- **Scope:** Reranker boundary, scoring, diversity/context rules, Evidence Package construction.
- **Out of scope:** Verdict judgment or source discovery outside the Evidence Base.
- **Expected files:** `src/server/evidence`, schemas, retrieval evals/tests.
- **Acceptance criteria:** Packages are bounded, traceable, and expose inadequate coverage.
- **Required tests:** deterministic ranking unit, adapter failures, relevance/coverage evals.
- **Suggested Codex model:** Sol.
- **QA requirements:** Reviewer and AI QA for misleading snippets and injection.
- **Definition of Done:** Candidate-to-package selection improves or preserves agreed retrieval baseline.

## Session 11 — Fact-check Engine

- **Goal:** Produce validated evidence-bound verdicts and explanations.
- **Why:** This is the core trust-critical comparison step.
- **Scope:** Judgment prompt/schema, taxonomy enforcement, confidence, citation membership, persistence.
- **Out of scope:** Additional retrieval, model-memory evidence, report UI.
- **Expected files:** judgment service/provider adapter, fact-check repositories, evals/tests.
- **Acceptance criteria:** Only six verdicts; all citations belong to the package and support conclusions.
- **Required tests:** validators/domain unit, malformed adapter tests, verdict/citation/hallucination evals.
- **Suggested Codex model:** Sol.
- **QA requirements:** Reviewer, Test Engineer, mandatory independent AI QA.
- **Definition of Done:** Golden cases meet thresholds with zero fabricated citation acceptance.

## Session 12 — Full Pipeline

- **Goal:** Connect upload through final persisted fact checks.
- **Why:** Validate contracts, state transitions, idempotency, and recovery end-to-end.
- **Scope:** Workflow composition, stage persistence, retry/resume, usage boundary hook without pricing.
- **Out of scope:** Polished report UI, history, payments.
- **Expected files:** workflows/services/repositories, integration/E2E tests.
- **Acceptance criteria:** One video reaches terminal success/failure without duplicate artifacts.
- **Required tests:** workflow integration, retry/race/failure cases, full-path E2E, evals, build.
- **Suggested Codex model:** Terra; Sol for difficult orchestration review.
- **QA requirements:** All Reviewer, Test Engineer, and AI QA roles.
- **Definition of Done:** Repeatable end-to-end analysis persists an auditable result.

## Session 13 — Report UI

- **Goal:** Present claims, verdicts, confidence, explanations, timestamps, evidence, and sources.
- **Why:** Users need an understandable, inspectable result.
- **Scope:** Accessible report route/components, states, citation/source navigation, limitations.
- **Out of scope:** Editing verdicts, sharing/social, history dashboard.
- **Expected files:** report feature/routes/components, E2E/accessibility tests.
- **Acceptance criteria:** Every displayed conclusion traces to evidence; loading/error/empty states are clear.
- **Required tests:** component unit, report E2E, build.
- **Suggested Codex model:** Terra.
- **QA requirements:** Reviewer and Test Engineer; AI QA checks presentation does not overstate confidence.
- **Definition of Done:** Owned completed analysis renders a complete auditable report.

## Session 14 — Analysis History

- **Goal:** Add an owned dashboard and past-analysis navigation.
- **Why:** Users must revisit results and understand job status.
- **Scope:** Paginated history query, dashboard states, report links.
- **Out of scope:** Search/advanced filters, team sharing, bulk operations.
- **Expected files:** history feature/routes/repository/tests.
- **Acceptance criteria:** Users see only their items; pagination/statuses behave consistently.
- **Required tests:** repository/RLS integration, empty/pagination E2E, build.
- **Suggested Codex model:** Terra.
- **QA requirements:** Reviewer and authorization-focused Test Engineer.
- **Definition of Done:** User history is secure, usable, and resilient to partial/failed jobs.

## Session 15 — Usage & Entitlements

- **Goal:** Enforce free limits through provider-independent services and a mock billing adapter.
- **Why:** Prepare monetization without coupling business logic to payments.
- **Scope:** Plans/entitlements/usage entities, services, concurrency-safe reservation/recording, explicit mock adapter for non-production use.
- **Out of scope:** Stripe, checkout, real subscriptions/payments.
- **Expected files:** billing domain/services, migrations, authorization hooks, tests.
- **Acceptance criteria:** Runtime decisions use entitlements/usage; parallel starts cannot exceed limits.
- **Required tests:** calculation/idempotency/race unit/integration, limit E2E, build.
- **Suggested Codex model:** Sol for architecture; Terra for implementation.
- **QA requirements:** Reviewer and Test Engineer focused on races/authorization.
- **Definition of Done:** Free usage policy is auditable, vendor-neutral, and correctly enforced.

## Session 16 — AI Eval Infrastructure

- **Goal:** Establish versioned golden datasets, runner, metrics, and baseline reporting.
- **Why:** AI quality needs measurable regression gates.
- **Scope:** Reviewed fixture schema, dataset splits, runners, metric calculations, baselines and thresholds.
- **Out of scope:** Claiming medical validation from synthetic examples or optimizing to hidden cases.
- **Expected files:** `evals`, schemas/runners, documentation, CI command.
- **Acceptance criteria:** Reproducible versioned reports cover extraction, retrieval, verdict, citations, hallucination.
- **Required tests:** metric unit tests, runner integration, `pnpm evals`.
- **Suggested Codex model:** Sol.
- **QA requirements:** Independent AI QA and dataset-review checklist.
- **Definition of Done:** Baseline and blocking regression policy are documented and executable.

## Session 17 — QA Hardening

- **Goal:** Run independent Reviewer, Test Engineer, and AI QA passes and fix confirmed defects.
- **Why:** Builder assumptions need adversarial challenge before release hardening.
- **Scope:** Findings, scoped fixes, regression tests/evals, documentation corrections.
- **Out of scope:** New product features and opportunistic redesign.
- **Expected files:** Only files needed for confirmed findings plus QA report.
- **Acceptance criteria:** Every BLOCKER/HIGH is fixed or explicitly blocks progress; no weakened tests.
- **Required tests:** All affected suites, full check, E2E, evals, build.
- **Suggested Codex model:** Sol for reviews; Terra/Luna for bounded fixes/tests.
- **QA requirements:** Separate sessions for all three roles.
- **Definition of Done:** Findings are triaged with evidence and required gates are green.

## Session 18 — Failure Scenarios

- **Goal:** Harden timeouts, retries, provider/API/database failures, and malformed inputs.
- **Why:** The asynchronous multi-provider path must fail safely and recoverably.
- **Scope:** Error taxonomy, retry budgets, idempotency, cancellation/resume, user-facing states.
- **Out of scope:** New providers/features and silent fallback that changes semantics.
- **Expected files:** workflows/adapters/error UI, regression/integration/E2E tests.
- **Acceptance criteria:** Transient/permanent errors differ; retries do not duplicate data/usage.
- **Required tests:** timeout/rate-limit/malformed/database/race suites, E2E, build.
- **Suggested Codex model:** Sol for difficult debugging; Terra otherwise.
- **QA requirements:** Reviewer and adversarial Test Engineer.
- **Definition of Done:** Catalogued critical failures have deterministic behavior and coverage.

## Session 19 — Security

- **Goal:** Audit and harden auth, RLS, Storage, secrets, validation, and prompt injection boundaries.
- **Why:** User media and evidence-grounded AI create high-impact trust boundaries.
- **Scope:** Threat model, authorization tests, upload hardening, server/client audit, injection defenses, dependency/config review.
- **Out of scope:** New product behavior or unsupported compliance claims.
- **Expected files:** policies/config/validators/prompts/security tests and audit report.
- **Acceptance criteria:** No cross-user access, browser secret leakage, or retrieved-instruction execution.
- **Required tests:** RLS/authorization/injection/adversarial tests, all gates, build.
- **Suggested Codex model:** Sol.
- **QA requirements:** Independent security review plus AI QA.
- **Definition of Done:** No open BLOCKER/HIGH security findings and limitations are documented.

## Session 20 — Observability

- **Goal:** Add structured logging, error correlation, token/cost usage, and job metrics.
- **Why:** Operations require diagnosis and cost/quality visibility without leaking sensitive data.
- **Scope:** Event schema, correlation IDs, redaction, stage latency/error metrics, provider usage metadata.
- **Out of scope:** Large observability platform or logging raw videos/transcripts/prompts by default.
- **Expected files:** observability module, workflow/provider instrumentation, tests/docs.
- **Acceptance criteria:** One analysis is traceable across stages; secrets/unsafe content are redacted.
- **Required tests:** logger/redaction unit, instrumentation integration, all gates/build.
- **Suggested Codex model:** Terra.
- **QA requirements:** Reviewer for privacy/cardinality and Test Engineer for failure paths.
- **Definition of Done:** Useful low-risk operational signals cover critical stages.

## Session 21 — MVP Release Audit

- **Goal:** Audit release readiness and resolve only blockers/regressions.
- **Why:** Final acceptance must be independent and evidence-based.
- **Scope:** Documentation/diff audit, all required checks, security/data/AI quality review, blocker fixes only.
- **Out of scope:** New features, architecture experiments, payments.
- **Expected files:** Release report and files required for confirmed blocker fixes.
- **Acceptance criteria:** Required gates pass; migrations/runbooks/env/deployment match reality; no known blockers.
- **Required tests:** lint, typecheck, all tests, E2E, evals, build, migration/security checks.
- **Suggested Codex model:** Sol.
- **QA requirements:** Independent RELEASE GATE; PASS only when every required check succeeds.
- **Definition of Done:** Release gate returns PASS with exact evidence, or release remains blocked.

## Post-MVP — Payments

- **Goal:** Implement one real `BillingProvider`, such as Stripe, after a separate product decision.
- **Why:** Monetization should build on proven entitlements/usage, not shape the MVP prematurely.
- **Scope:** Checkout, signed idempotent webhooks, normalized subscriptions, reconciliation, cancellation.
- **Out of scope:** Coupling runtime access to provider objects or changing fact-check behavior.
- **Expected files:** provider adapter/webhook routes, billing migrations/config, tests/docs.
- **Acceptance criteria:** Entitlements remain the authorization source; events are secure and order-safe.
- **Required tests:** adapter/contract, webhook signature/order/idempotency, checkout/cancel E2E, all gates.
- **Suggested Codex model:** Sol for architecture/security; Terra for implementation.
- **QA requirements:** Reviewer, Test Engineer, security review, final release gate.
- **Definition of Done:** Real billing is secure, reconciled, observable, and replaceable.

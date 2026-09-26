# MVP Product Definition

## Problem

Short-form psychology content often compresses nuanced research into confident, decontextualized claims. A viewer rarely has the time or expertise to locate relevant studies, assess their quality, and determine whether the evidence supports the exact claim.

## Target user

The initial user is a research-minded consumer, creator, educator, or psychology professional who wants a transparent first-pass evidence review of one video. The service supports investigation; it does not provide diagnosis, treatment, or clinical advice.

## Core flow

1. A user signs up or logs in.
2. They upload one video and start an analysis.
3. The system transcribes it with timestamps and extracts checkable claims.
4. Each claim is normalized and classified.
5. Retrieval finds and reranks relevant records from the internal Evidence Base.
6. Judgment compares the claim only with its Evidence Package.
7. The user receives original/normalized claims, timestamps, verdicts, confidence, explanations, evidence, and sources.
8. The user can revisit prior analyses.

## Current implementation status

The current code implements only part of this flow:

- `/` provides the token-based sign-in, registration, and recovery-code presentation UI.
- Server Actions generate a one-time registration token, create a token-backed Supabase Auth account, authenticate with an access token, and sign out.
- `/dashboard` validates the session server-side, lists the authenticated user's `content_items`, and provides a single-video upload form.
- `POST /api/uploads/video` validates MP4, WebM, or MOV files up to 100 MiB, uploads to the private `videos` bucket, and creates an owned content row with upload idempotency.
- `/ui-preview/*` contains interface prototypes for history, upload, processing, report, and profile. These screens are not connected to the corresponding persisted product workflows.

The upload creates a `pending` content item. It does not create an `analysis_jobs` row or start processing. Transcription, claim extraction/normalization/classification, Evidence Base, embeddings, retrieval, reranking, judgment, report persistence, history pagination, usage enforcement, and recovery are not implemented. The complete flow above remains the product target, not a claim about current behavior.

## MVP scope

- Token-based authentication and protected user data (implemented foundation)
- One video upload to private storage with validation and idempotency (implemented foundation)
- Analysis job execution and live status tracking (future implementation)
- Transcription, claim extraction, normalization, and classification
- A small curated Evidence Base with embeddings, retrieval, metadata filters, and reranking
- Evidence-grounded fact-check judgments and structured reports
- Analysis history
- Provider boundaries for AI, transcription, embeddings, content, and billing
- Basic entitlements/usage without real payments
- Automated tests and AI evaluation infrastructure

## Out of scope

Instagram scraping/profile analysis, batch Reel analysis, payments/subscriptions, social features, mobile apps, a complex admin panel, self-hosted models, and a production-scale Evidence Base.

## Assumptions

- Users accept asynchronous processing and understand the result is informational.
- One language and a limited set of supported video formats may be selected during implementation.
- Evidence is curated/imported rather than discovered live on the public web.
- A verdict applies to the normalized claim in context, not the speaker's character or intent.

## Constraints

One developer builds through Codex. The architecture is a TypeScript modular monolith. External services must be replaceable. Long-running work must be resumable, structured AI output must be validated, and every citation must trace to a real Evidence Base source.

The current authentication model uses generated access tokens rather than user-chosen email/password credentials. Recovery codes are displayed once, but no recovery endpoint exists yet. Review [Authentication](../architecture/AUTH.md) before changing this model.

## Definition of Done

The MVP is done when the critical flow works end-to-end for an authenticated user; ownership and RLS protect all user data; failures produce actionable, recoverable states; a report contains every required field and traceable citations; usage limits are enforced through service abstractions; required unit, integration, E2E, eval, security, and production-build gates pass; documentation matches the implementation; and the Session 21 release audit returns PASS.

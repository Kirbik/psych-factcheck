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

## MVP scope

- Authentication and protected user data
- One video per analysis, private storage, validation, and status tracking
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

## Definition of Done

The MVP is done when the critical flow works end-to-end for an authenticated user; ownership and RLS protect all user data; failures produce actionable, recoverable states; a report contains every required field and traceable citations; usage limits are enforced through service abstractions; required unit, integration, E2E, eval, security, and production-build gates pass; documentation matches the implementation; and the Session 21 release audit returns PASS.

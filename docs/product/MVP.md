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
- `/dashboard` validates the session server-side, lists the authenticated user's `content_items`, and provides a single-video upload form. `/new-check` also uploads its selected video and continues only after the object is validated and its `content_items` record succeeds.
- The authenticated upload endpoints prepare a single signed TUS upload to the private `videos` bucket at `/storage/v1/upload/resumable/sign` and finalize it only after server-side validation of object ownership, actual size, and container signature. A root-layout upload manager keeps an in-flight upload running across in-app navigation. A full page reload, closing the tab, or browser restart interrupts byte transfer; after reload in the same tab, the app restores the paused progress screen and lets the user resume the same file. On supported browsers a user-granted file handle is kept in IndexedDB; otherwise the user must select the original file again. The video bytes are not stored in browser storage. Canceling clears the active/interrupted task so the user can choose another file.
- `/history`, `/report`, and `/profile` contain interface prototypes. `/processing?contentItemId=...` and the post-upload view on `/new-check` display persisted validation, screening, transcription, and claim-extraction status; the route without an ID remains a preview. Evidence stages stay pending and report access remains disabled. Active workflow messages show an activity indicator; a completed out-of-scope screening appears as a warning.

The upload creates a `pending` content item and atomically queues one versioned job. The deployed workflow validates the stored upload, screens supported audio before transcription, and continues unless a valid screening result is clearly and confidently out of scope. Videos up to 12 seconds are screened using the full audio track; longer videos use at most three four-second samples. If MP4 metadata omits audio duration, the Worker computes it from encoded packet timestamps. Unavailable/uncertain screening fails open. Supported MP4/WebM uploads up to 25 MB are transcribed with OpenAI `whisper-1`; timestamped segments are validated and persisted, then `gpt-4o-mini` extracts and stores claims. The workflow and migrations are deployed in Production, and at least one Production job completed through claim extraction on 2026-09-30. A fresh upload is still needed to verify the duration fallback for the previously missed MP4. The Evidence Base v0 catalog is deployed with 10 sources and 23 passages. Session 9's embedding schema and pgvector candidate search, plus Session 10's workflow-integrated reranking and persisted Evidence Packages, are deployed. Claim model quality, verdict judgment, report persistence, history pagination, usage enforcement, and account recovery are not complete. The complete flow above remains the product target, not a claim about current behavior.

## MVP scope

- Token-based authentication and protected user data (implemented foundation)
- One video upload to private storage with validation and idempotency (implemented foundation)
- Durable Cloudflare video workflow with screening, transcription, claim extraction, and persisted status (Production deployed; broader live/model-quality verification remains)
- Transcription, claim extraction, normalization, and classification
- A small curated Evidence Base catalog (implemented); versioned embeddings and metadata-filtered candidate retrieval (deployed, not workflow-integrated); reranking (planned)
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

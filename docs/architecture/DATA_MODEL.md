# Data Model

This is a deliberately small conceptual model for future migrations. IDs are UUIDs, timestamps are UTC, mutable tables have `created_at`/`updated_at`, and user-owned data uses RLS plus server-side ownership checks. Session 2 implements only `profiles`, `content_items`, and `analysis_jobs` in `supabase/migrations/20260912000000_initial_foundation.sql`; remaining entities are future design, not current schema.

## Identity and content

### `profiles`

- **Purpose:** application profile extending the Supabase Auth user.
- **Implemented fields:** `id` (Auth user ID), `created_at`, `updated_at`.
- **Relations/ownership:** one Auth user; owns content and billing state. The user can read/update their own safe fields.
- **Lifecycle:** created on signup, retained/deleted according to account policy.

### `content_items`

- **Purpose:** one uploaded or future provider-sourced media item.
- **Implemented fields:** `id`, `user_id`, `type`, `status`, `created_at`, `updated_at`. `type` is currently the `video` enum; `status` is constrained to `pending`, `ready`, or `failed`.
- **Relations/ownership:** belongs to profile; has transcripts and analysis jobs. User-owned.
- **Lifecycle:** created before upload finalization, processed, then retained or deleted with its media.

### `transcripts`

- **Purpose:** versioned transcription output for a content item.
- **Important fields:** `id`, `content_item_id`, `provider`, `model`, `language`, timestamped segments JSON, status.
- **Relations/ownership:** belongs to content item; source for claims. Ownership derives from content item.
- **Lifecycle:** created by workflow; immutable after completion except explicit replacement/versioning.

### `claims`

- **Purpose:** checkable proposition extracted from a transcript.
- **Important fields:** `id`, `transcript_id`, original text, normalized text, start/end timestamps, claim type, extraction version.
- **Relations/ownership:** belongs to transcript; has fact checks. Ownership derives from content item.
- **Lifecycle:** written idempotently per pipeline version; superseded rather than silently rewritten.

## Evidence and fact checks

### `sources`

- **Purpose:** canonical metadata for a real publication or authoritative resource.
- **Important fields:** `id`, title, authors, publication date, DOI/URL, source type, status, provenance.
- **Relations/ownership:** has evidence chunks; shared system-curated data, not user-owned.
- **Lifecycle:** imported, reviewed, corrected/versioned, optionally withdrawn/retracted without erasing audit history.

### `evidence_chunks`

- **Purpose:** retrievable source passages with vector representation.
- **Important fields:** `id`, `source_id`, text, location, metadata, embedding, embedding model/version.
- **Relations/ownership:** belongs to source; linked by fact-check evidence. Shared curated data.
- **Lifecycle:** generated from a source version; re-embedded/versioned when models change.

### `fact_checks`

- **Purpose:** versioned judgment for one claim and frozen retrieval run.
- **Important fields:** `id`, `claim_id`, verdict, confidence, explanation, pipeline/prompt versions, status, limitations.
- **Relations/ownership:** belongs to claim; has evidence links. Ownership derives from the claim's content item.
- **Lifecycle:** created pending, completed/failed, never silently mutated after publication; reruns create versions.

### `fact_check_evidence`

- **Purpose:** auditable join between a fact check and evidence used or cited.
- **Important fields:** `fact_check_id`, `evidence_chunk_id`, rank, retrieval/rerank scores, `is_cited`, stance.
- **Relations/ownership:** many-to-many join; ownership derives from fact check while evidence is shared.
- **Lifecycle:** frozen with the Evidence Package and retained with the fact check.

## Orchestration

### `analysis_jobs`

- **Purpose:** durable analysis state and retry/audit record.
- **Implemented fields:** `id`, `user_id`, `content_item_id`, `status`, `created_at`, `updated_at`. `status` is constrained to `queued`, `running`, `completed`, `failed`, or `cancelled`; workflow metadata remains future scope.
- **Relations/ownership:** belongs to user and content item; coordinates downstream records. User can read their status; server controls writes.
- **Lifecycle:** queued, running, completed, failed, or cancelled; terminal records retained for history/operations.

## Commercial access

### `plans`

- **Purpose:** internal catalog of limits and capabilities independent of a provider.
- **Important fields:** `id`, stable key, name, active flag, version/metadata.
- **Relations/ownership:** referenced by subscriptions/entitlements; system-managed.
- **Lifecycle:** versioned or deactivated, not repurposed incompatibly.

### `subscriptions`

- **Purpose:** normalized subscription state.
- **Important fields:** `id`, `user_id`, `plan_id`, provider, provider subscription ID, status, period boundaries.
- **Relations/ownership:** belongs to profile and plan; server-managed, user-readable.
- **Lifecycle:** created/updated idempotently from verified events; cancellation preserves history.

### `billing_customers`

- **Purpose:** map an application user to a billing provider customer.
- **Important fields:** `user_id`, provider, opaque provider customer ID.
- **Relations/ownership:** belongs to profile; server-only writes and tightly restricted reads.
- **Lifecycle:** created on first billing interaction; retained per financial/privacy requirements.

### `entitlements`

- **Purpose:** provider-independent grants and limits used for authorization.
- **Important fields:** `id`, `user_id` and/or `plan_id`, key, value/limit, effective interval, source.
- **Relations/ownership:** derived from plan/subscription or explicit grant; server-managed.
- **Lifecycle:** recalculated/versioned on access changes; expired grants remain auditable.

### `usage_events`

- **Purpose:** append-only record of metered actions.
- **Important fields:** `id`, `user_id`, entitlement key, quantity, idempotency key, analysis ID, occurred_at.
- **Relations/ownership:** belongs to user and optionally analysis job; server-only writes.
- **Lifecycle:** appended transactionally and never edited in normal operation; corrections use compensating events.

## Implemented integrity baseline

`profiles.id` references `auth.users.id`. New Auth users receive a profile through a minimal idempotent database trigger. `content_items.user_id` references `profiles.id`. `analysis_jobs` references the same `(content_item_id, user_id)` pair, preventing a job from claiming a different owner than its content item. The initial migration uses not-null fields, enum constraints, foreign keys, indexes for owner history queries, automatic `updated_at`, and RLS.

## Future integrity baseline

Use foreign keys, check constraints for enums/ranges, unique idempotency keys, and indexes based on measured queries. Vector indexes belong on version-compatible embeddings. Do not put large video bytes or raw secrets in PostgreSQL. Deletion policy must distinguish user content, shared scientific sources, and legally required billing audit data.

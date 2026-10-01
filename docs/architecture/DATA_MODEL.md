# Data Model

This document distinguishes the current Supabase schema from the planned analysis and billing model. IDs are UUIDs, timestamps are UTC, and user-owned rows use RLS plus server-side ownership checks. The repository migrations implement `profiles`, `content_items`, `analysis_jobs`, `video_screenings`, `transcripts`, `claim_extractions`, `claims`, the shared `sources` and `evidence_chunks` catalog, versioned `evidence_embeddings` and `claim_embeddings`, three token-auth tables, and a private video bucket. The Session 9 migration has not yet been applied to Production. Fact-check and billing entities remain future schema.

## Identity and content

### `profiles`

- **Purpose:** application profile extending the Supabase Auth user.
- **Implemented fields:** `id` (Auth user ID), `created_at`, `updated_at`.
- **Relations/ownership:** one Auth user; owns content and billing state. The user can read/update their own safe fields.
- **Lifecycle:** created on signup, retained/deleted according to account policy.

### `auth_access_tokens`

- **Purpose:** map a server-generated access-token digest to its Supabase Auth user.
- **Implemented fields:** `user_id`, `token_hash` (SHA-256 hex), `created_at`, and nullable `revoked_at`.
- **Relations/ownership:** one token credential per Auth user; the FK cascades on Auth user deletion.
- **Security:** RLS is enabled, no client role has table privileges, and only the server-only service-role client accesses it. Raw tokens are never stored in this table.
- **Lifecycle:** created with a new account; token is returned to the user once. Losing it means creating a new account, with no transfer of the previous history.

### `auth_pending_access_tokens`

- **Purpose:** hold the digest of a generated registration token until signup consumes it.
- **Implemented fields:** `token_hash` (SHA-256 hex, primary key), `created_at`, and `expires_at` (24 hours after creation).
- **Relations/ownership:** no user relation until the token is consumed; server-only table.
- **Security/lifecycle:** RLS is enabled and only the service role has access. The registration action returns the raw token once; registration atomically removes the pending row before creating the account. Expired entries are cleaned up when another registration token is generated.

### `auth_recovery_codes`

- **Purpose:** store a lookup digest for the one-time recovery code shown after registration.
- **Implemented fields:** `user_id` (primary key/FK to `auth.users`), `code_hash` (SHA-256 hex), `created_at`.
- **Relations/ownership:** one recovery-code digest per Auth user; server-only table.
- **Security/lifecycle:** RLS is enabled and client grants are revoked. The raw recovery code is not stored. No public recovery/rotation flow currently uses this table.

### `content_items`

- **Purpose:** one uploaded or future provider-sourced media item.
- **Implemented fields:** `id`, `user_id`, `type`, `status`, `storage_path`, `original_file_name`, `file_size_bytes`, `file_mime_type`, `upload_id`, `created_at`, `updated_at`. `type` is currently the `video` enum; `status` is constrained to `pending`, `ready`, or `failed`; maximum file size is 100 MiB; `(user_id, upload_id)` is unique; storage paths must begin with the owner UUID.
- **Relations/ownership:** belongs to profile; has transcripts and analysis jobs. User-owned.
- **Lifecycle:** created after a successful Storage upload. The upload API is idempotent per user/upload ID and attempts storage cleanup if DB creation fails. New records remain `pending`; no pipeline currently advances them to `ready` or `failed`.

### `transcripts`

- **Purpose:** versioned transcription output for a content item.
- **Implemented fields:** `id`, `content_item_id`, `pipeline_version`, `provider`, `model`, nullable `language`, timestamped `segments` JSON, `created_at`.
- **Relations/ownership:** belongs to content item; source for claims. Ownership derives from content item.
- **Lifecycle:** created by the transcription workflow after Zod validation; unique per content item and pipeline version, immutable on retries. Session 6 uses OpenAI `whisper-1` and stores segment start/end seconds and text. MP4/WebM up to 25 MB are supported; MOV and larger files fail with explicit job errors.

### `video_screenings`

- **Purpose:** retain a minimal diagnostic record of the pre-transcription topic-screening decision.
- **Implemented fields:** `content_item_id`, `screening_version`, provider and model identifiers, instruction version, decision, reason code, confidence, short rationale, bounded sample duration, and `created_at`.
- **Relations/ownership:** one row per content item and screening version; ownership derives from content. Only the Worker service role has table access.
- **Lifecycle:** unique by `(content_item_id, screening_version)` and reused across retries. The temporary sample transcript is not persisted. A high-confidence off-topic result completes the job without creating a transcript.

### `claims`

- **Purpose:** checkable proposition extracted from a transcript.
- **Implemented fields:** `id`, `claim_extraction_id`, ordinal, exact source excerpt, normalized text, start/end seconds, claim type, and `created_at`.
- **Relations/ownership:** belongs to a versioned `claim_extractions` row; ownership derives through extraction, transcript, and content item.
- **Lifecycle:** immutable and idempotent per extraction version. An extraction marker is stored even when the model returns no claims. The Worker-only atomic save function prevents duplicate or partial child rows on workflow retries.

### `claim_extractions`

- **Purpose:** record completed extraction, including empty results, and preserve the model/prompt/schema versions used.
- **Implemented fields:** transcript ID, extraction version, provider, model, instructions version, schema version, and `created_at`.
- **Relations/ownership:** belongs to a transcript; owner reads follow the transcript's content item. The service role writes.
- **Lifecycle:** unique by `(transcript_id, extraction_version)` and reused on retry.

## Evidence and fact checks

### `sources`

- **Purpose:** canonical metadata for a real publication or authoritative resource.
- **Implemented fields:** `id`, stable DOI-derived `source_key`, `title`, `authors`, `journal`, `publisher`, `published_at`, nullable `doi`, `canonical_url`, `source_type`, editorial `status`, `license_code`, `license_url`, `provenance`, and timestamps.
- **Relations/ownership:** shared curated catalog, not user-owned; has evidence chunks.
- **Lifecycle:** imported idempotently from a reviewed seed. Corrected/retracted/withdrawn status is not reset by an older seed. Metadata retains canonical publication and reuse-license links.

### `evidence_chunks`

- **Purpose:** concise, traceable source passages for later retrieval.
- **Implemented fields:** `id`, `source_id`, stable `chunk_key`, verbatim `content`, section `locator`, `language`, SHA-256 content digest, provenance, and timestamps.
- **Relations/ownership:** belongs to a shared source; deletion of a referenced source is restricted.
- **Lifecycle:** the Session 8 seed contains 23 verbatim passages from 9 publications and metadata for 10 publications. The transactional service-role import validates source links and updates stable rows on repeat. Authenticated users can read the shared catalog; clients cannot write it. Session 9 adds service-role-only `evidence_embeddings` and `claim_embeddings` rows keyed by the source entity and embedding version. Each row records provider, model, dimensions, source-text SHA-256, and a 1536-dimensional vector. Retrieval ignores stale chunk vectors and returns only active source records.

### Future evidence extensions

- Session 9 adds versioned vectors keyed to `evidence_chunks.id` and `claims.id`, with recorded model, dimension, and source-text digest. The current query RPC uses cosine similarity and supports language, source type, and publication-date filters while excluding non-active sources.
- Fact-check persistence will link judgments to a frozen set of evidence chunk IDs.
- Embedding model/version and retrieval traces must be recorded without replacing source text or provenance.

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
- **Implemented fields:** `id`, `user_id`, `content_item_id`, `status`, `created_at`, `updated_at`, `pipeline_version`, `generation`, `stage`, `run_id`, `attempt`, `error_code`, `started_at`, `completed_at`. `(content_item_id, pipeline_version)` is unique. `status` is constrained to `queued`, `running`, `completed`, `failed`, or `cancelled`.
- **Relations/ownership:** belongs to user and content item; `foreign key (content_item_id, user_id)` prevents mismatched ownership. User can read their status; server controls writes.
- **Lifecycle:** uploads queue jobs atomically. Owner-only request/retry and service-only transition RPCs enforce generation/run fencing. Session 6A adds `screen_video`; Session 7 adds `extract_claims`. High-confidence off-topic results complete with `VIDEO_OUT_OF_SCOPE`; other jobs complete after claims are validated and persisted. Content remains pending; evidence and reports are not produced. See [Workflows](WORKFLOWS.md).

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

`auth_access_tokens`, `auth_pending_access_tokens`, and `auth_recovery_codes` have RLS enabled with direct `anon`/`authenticated` access revoked; server-side privileged code stores only SHA-256 digests. The `videos` bucket is private, with object policies scoped to the first path segment matching `auth.uid()`.

## Future integrity baseline

Use foreign keys, check constraints for enums/ranges, unique idempotency keys, and indexes based on measured queries. Vector indexes belong on version-compatible embeddings. Do not put large video bytes or raw secrets in PostgreSQL. Deletion policy must distinguish user content, shared scientific sources, and legally required billing audit data.

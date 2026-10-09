# Data Model

IDs are UUIDs, timestamps UTC, and user-owned rows use RLS plus server ownership checks. Session 26 retires shared RAG tables and RPCs while retaining transcripts, claims, Evidence Packages, judgments, citations and narrative/history. Migration `20261009120000_retire_local_rag.sql` is prepared locally, not applied to Production. Historical migrations create the catalog before this upgrade removes it; the latest TypeScript contract describes the post-upgrade schema. Billing remains future schema.

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
- **Implemented fields:** `id`, `user_id`, `type`, `status`, `storage_path`, `original_file_name`, `file_size_bytes`, `file_mime_type`, `upload_id`, `created_at`, `updated_at`. `type` is currently the `video` enum; `status` is constrained to `pending`, `ready`, or `failed`; the database and Storage bucket permit up to 100 MiB, while the upload API caps new videos at the transcription provider's 25 MB limit; `(user_id, upload_id)` is unique; storage paths must begin with the owner UUID.
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

### Retired shared RAG storage

After Session 26 migration, `sources`, `evidence_chunks`, `evidence_embeddings`, `claim_embeddings`, `import_evidence_seed` and `match_evidence_chunks_v1` no longer exist. Existing package-item source snapshots gain publisher, DOI, license and original rights/provenance from the catalog before deletion. Unused catalog entries are removed; original claims, judgments, package payloads and identifiers are preserved. The pgvector extension is not dropped, because it may be shared with unrelated database objects.

### `evidence_packages`

- **Purpose:** immutable, versioned result of retrieving and reranking evidence for one extracted claim.
- **Implemented fields:** `id`, `claim_id`, retrieval/reranking versions, coverage (`none`, `limited`, or `multi_source`), warnings, trace, full package payload, and `created_at`.
- **Relations/ownership:** belongs to one claim; owner access follows claim → extraction → transcript → content. Authenticated users can select only their own packages. Writes are service-role-only through `save_evidence_packages`.
- **Lifecycle:** unique by `(claim_id, retrieval_version, reranking_version)`. Retries reuse an existing package. The saved payload retains claim wording, evidence/source snapshots, scores, filters, provider/search/prompt/schema versions, and trace for audit. Session 12 also stores bounded bibliographic references in the JSON payload; metadata-only references are labeled and excluded from evidence/citations. A licensed Europe PMC excerpt and its attribution are stored only as snapshots for this check. Source/excerpt UUIDs derive from publication identity and excerpt content. Unique package versions make retries idempotent. No full article is persisted.

### `evidence_package_items`

- **Purpose:** ordered evidence snapshots belonging to one claim package.
- **Implemented fields:** package ID, evidence chunk ID, ordinal (0–4), retrieval score, relevance score, and item snapshot and legacy source/excerpt provenance.
- **Relations/ownership:** references its owner-scoped package; the historical `evidence_chunk_id` field is now a snapshot identifier with no catalog foreign key. Owner reads are permitted only when the parent package belongs to the current user; clients cannot write.
- **Lifecycle:** created atomically with its package by `save_evidence_packages`; each package has at most five unique chunks. Each item remains available for the linked judgment citation.

### Search and judgment boundary

- Search versions are `publication-search-v1` / `external-evidence-v2`; packages use schema `evidence-package-v2` and reranker `evidence-reranking-v2`. Historical payloads keep optional embedding traces for read compatibility, with no runtime embedding calls.
- Europe PMC excerpts require publication-specific OA/CC BY 4.0 rights and a maximum of 1,000 characters. Unknown/unsuitable licenses and Crossref records remain metadata references. Full text is transient and is not retained.
- Model and database boundaries reject citations outside the exact package. Empty evidence cannot support an evidence-based verdict.

### `fact_checks` — Session 11, migration deployed

- **Purpose:** versioned judgment for one claim and frozen retrieval run.
- **Implemented fields:** `id`, `claim_id`, `evidence_package_id`, judgment version, provider/model/instruction/schema versions, verdict, confidence, explanation, limitations, and creation time.
- **Relations/ownership:** references one Evidence Package for the same claim. Owner reads follow claim → extraction → transcript → content; writes are restricted to the service-role RPC.
- **Lifecycle:** immutable per claim, Evidence Package, and judgment version; retries return the existing row. Session 12's wrapper locks and checks the active job generation, run, and `judge_claims` stage before writing. Judgment prompt/model/schema versions remain independent of search versions. No Production upgrade verification has been performed for Session 26.

### `fact_check_evidence` — Session 11, migration deployed

- **Purpose:** auditable join between a fact check and evidence used or cited.
- **Implemented fields:** `fact_check_id`, `evidence_package_id`, `evidence_chunk_id`, citation ordinal, relation (`supports`, `qualifies`, or `contradicts`), and rationale.
- **Relations/ownership:** ownership derives from the fact check; composite foreign keys bind the citation to both the fact check's exact package and an item in that package.
- **Lifecycle:** citations are frozen with the fact check. The persistence path rejects chunk IDs absent from the linked Evidence Package.

### `analysis_report_narratives` — Session 25, migration deployed 2026-10-03

- **Purpose:** store the separate model commentary for each claim, the overall video conclusion, and explicitly subjective model opinion after all fact checks are persisted.
- **Fields:** `job_id`, `content_item_id`, `generation`, `provider`, `model`, `narrative_version`, `prompt_version`, `schema_version`, `payload`, `created_at`.
- **Integrity:** unique per job generation and schema version; the service-only save RPC checks the active `judge_claims` run and verifies each commentary's claim/fact-check relationship. The artifact contains generated text, not copies of article passages.
- **Access:** RLS permits owner reads; clients cannot write. Workflow persistence uses the run-fenced security-definer RPC.
- **Compatibility:** older completed analyses without this artifact remain readable and display that commentary is unavailable.
- **Historical opinion context:** optional `payload.historicalReferences` records the selected catalogue ID, related claim ID, catalogue version, author, book, publication year, consulted edition, locator, primary URL and editorial paraphrase. It is explanatory historical context, outside scientific evidence and citation tables. Persisted payload schema v1 accepts older artifacts without this field; no new migration is required.

## Orchestration

### `analysis_jobs`

- **Purpose:** durable analysis state and retry/audit record.
- **Implemented fields:** `id`, `user_id`, `content_item_id`, `status`, `created_at`, `updated_at`, `pipeline_version`, `generation`, `stage`, `run_id`, `attempt`, `error_code`, `started_at`, `completed_at`. `(content_item_id, pipeline_version)` is unique. `status` is constrained to `queued`, `running`, `completed`, `failed`, or `cancelled`.
- **Relations/ownership:** belongs to user and content item; `foreign key (content_item_id, user_id)` prevents mismatched ownership. User can read their status; server controls writes.
- **Lifecycle:** uploads queue jobs atomically. Owner-only request/retry and service-only transition RPCs enforce generation/run fencing. Session 6A adds `screen_video`; Session 7 adds `extract_claims`; Session 10 adds `build_evidence`; Session 12 adds `judge_claims`; Session 25 stores a fenced report-narrative artifact before completion. High-confidence off-topic results complete with `VIDEO_OUT_OF_SCOPE`. See [Workflows](WORKFLOWS.md).

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

Use foreign keys, check constraints for enums/ranges, unique idempotency keys, and indexes based on measured queries. Do not put large video bytes or raw secrets in PostgreSQL. Deletion policy must distinguish user content, owner-scoped evidence snapshots, and legally required billing audit data.

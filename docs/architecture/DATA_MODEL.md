# Data Model

This document distinguishes the implemented repository schema from deployed Production state and planned domains. IDs are UUIDs, timestamps are UTC, and user-owned rows use RLS plus server-side ownership checks. The repository migrations implement `profiles`, `content_items`, `analysis_jobs`, `video_screenings`, `transcripts`, `claim_extractions`, `claims`, the shared `sources` and `evidence_chunks` catalog, versioned `evidence_embeddings` and `claim_embeddings`, `evidence_packages` and `evidence_package_items`, Session 11's `fact_checks` and `fact_check_evidence`, Session 25's `analysis_report_narratives`, three token-auth tables, and a private video bucket. Session 9 retrieval, Session 10 evidence-package, Session 11 fact-check, Session 23 expanded-screening, and Session 24 Russian bibliography migrations are deployed to Production. Session 25 report-narrative migration is implemented locally and has not been deployed. Production contains 21 sources, 33 evidence chunks, and 33 current evidence vectors as of 2026-10-03; claim embeddings are supported by schema but are not currently populated. Billing entities remain future schema.

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

The Session 12 live-search extension uses the existing source, chunk, package,
and fact-check citation records; it does not add or drop tables. Crossref and
metadata-only publication records are snapshotted in the package JSON as
non-citable references. Only a license-verified Europe PMC CC BY 4.0 excerpt
is inserted into the existing shared catalog. The excerpt row carries the API
provider, provider version, PMCID, license URL, and storage limit provenance.

The Session 12 live-search extension uses the existing source, chunk, package,
and fact-check citation records; it does not add or drop tables. Crossref and
metadata-only publication records are snapshotted in the package JSON as
non-citable references. Only a license-verified Europe PMC CC BY 4.0 excerpt
is inserted into the existing shared catalog. The excerpt row carries the API
provider, provider version, PMCID, license URL, and storage limit provenance.

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

### `evidence_packages`

- **Purpose:** immutable, versioned result of retrieving and reranking evidence for one extracted claim.
- **Implemented fields:** `id`, `claim_id`, retrieval/reranking versions, coverage (`none`, `limited`, or `multi_source`), warnings, trace, full package payload, and `created_at`.
- **Relations/ownership:** belongs to one claim; owner access follows claim → extraction → transcript → content. Authenticated users can select only their own packages. Writes are service-role-only through `save_evidence_packages`.
- **Lifecycle:** unique by `(claim_id, retrieval_version, reranking_version)`. Retries reuse an existing package. The saved payload retains claim wording, evidence/source snapshots, scores, filters, provider/search/prompt/schema versions, and trace for audit. Session 12 also stores bounded bibliographic references in the JSON payload; metadata-only references are labeled and excluded from evidence/citations. A licensed Europe PMC excerpt is stored in the existing source/chunk catalog and linked through the existing package-item table. Stable DOI/PMCID source keys and chunk keys make retries idempotent. No full article is persisted.

### `evidence_package_items`

- **Purpose:** ordered relational links from a package to the selected Evidence Base chunks.
- **Implemented fields:** package ID, evidence chunk ID, ordinal (0–4), retrieval score, relevance score, and item snapshot.
- **Relations/ownership:** references a package and a shared evidence chunk. Owner reads are permitted only when the parent package belongs to the current user; clients cannot write.
- **Lifecycle:** created atomically with its package by `save_evidence_packages`; each package has at most five unique chunks. Referenced chunks cannot be deleted while linked.

### Retrieval and judgment boundary

- Session 9 deploys versioned 1536-dimensional vectors keyed to `evidence_chunks.id` and provides a `claim_embeddings` table. The current workflow embeds claim text in batches as retrieval queries but does not persist those query vectors. Stored chunk vectors include model/version and source-text digest; the query RPC uses cosine similarity and supports language, source type, and publication-date filters while excluding non-active sources.
- Evidence Package persistence links each claim's retrieval/reranking result to a frozen set of evidence chunk IDs. Session 11's judgment persistence and Session 12's run-fenced Worker integration are deployed to Production. A fresh authenticated Production analysis completed the combined path at `stage = complete` in generation 2.
- Embedding model/version and retrieval traces must be recorded without replacing source text or provenance. Europe PMC excerpt provenance records PMCID, OA access type, CC BY 4.0 URL, provider version, and excerpt limit; only confirmed CC BY 4.0 text is persisted. Crossref records and any record with unknown or incompatible reuse terms remain package metadata, not evidence. The extension adds no relational tables and leaves legacy evidence/package/citation tables compatible.

### `fact_checks` — Session 11, migration deployed

- **Purpose:** versioned judgment for one claim and frozen retrieval run.
- **Implemented fields:** `id`, `claim_id`, `evidence_package_id`, judgment version, provider/model/instruction/schema versions, verdict, confidence, explanation, limitations, and creation time.
- **Relations/ownership:** references one Evidence Package for the same claim. Owner reads follow claim → extraction → transcript → content; writes are restricted to the service-role RPC.
- **Lifecycle:** immutable per claim, Evidence Package, and judgment version; retries return the existing row. Session 12's wrapper locks and checks the active job generation, run, and `judge_claims` stage before writing. Judgment now uses schema v2 and instructions v3 to ignore reference metadata. The live-search extension is not Production-deployed or verified.

### `fact_check_evidence` — Session 11, migration deployed

- **Purpose:** auditable join between a fact check and evidence used or cited.
- **Implemented fields:** `fact_check_id`, `evidence_chunk_id`, citation ordinal, relation (`supports`, `qualifies`, or `contradicts`), and rationale.
- **Relations/ownership:** many-to-many join; ownership derives from fact check while evidence is shared.
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

Use foreign keys, check constraints for enums/ranges, unique idempotency keys, and indexes based on measured queries. Vector indexes belong on version-compatible embeddings. Do not put large video bytes or raw secrets in PostgreSQL. Deletion policy must distinguish user content, shared scientific sources, and legally required billing audit data.

### `analysis_report_narratives` — Session 25, migration pending deployment

- **Purpose:** store the separate model commentary for each claim, the overall video conclusion, and explicitly subjective model opinion after all fact checks are persisted.
- **Fields:** `job_id`, `content_item_id`, `generation`, `provider`, `model`, `narrative_version`, `prompt_version`, `schema_version`, `payload`, `created_at`.
- **Integrity:** unique per job generation and schema version; the service-only save RPC checks the active `judge_claims` run and verifies each commentary's claim/fact-check relationship. The artifact contains generated text, not copies of article passages.
- **Access:** RLS permits owner reads; clients cannot write. Workflow persistence uses the run-fenced security-definer RPC.
- **Compatibility:** older completed analyses without this artifact remain readable and display that commentary is unavailable.

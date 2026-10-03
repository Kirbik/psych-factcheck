# AI Pipeline

## Current status

Topic screening v2 covers psychology and adult romantic relationships, couple
communication, sexual relationships, and adult sexual health. Prompt and
reason-code versions are recorded independently from prior screening results.

The Cloudflare Workflow screens a bounded audio sample, transcribes relevant or uncertain videos with OpenAI `whisper-1`, then extracts, normalizes, and classifies claims with OpenAI `gpt-4o-mini`. Sessions 6A–7 are deployed in Production. A Production job completed through claim extraction on 2026-09-30 after earlier source-validation failures and fixes. Screening now falls back to packet-derived duration when MP4 metadata omits it; a fresh upload is still needed to verify that case end to end. Session 8's source/chunk schema and reviewed, idempotent seed were deployed to Production with 10 sources and 23 evidence chunks; Session 23 expanded this to 13 sources and 27 passages, with 27 current vectors. Session 9's versioned 1536-dimensional embedding schema and provenance-preserving pgvector search RPC are also deployed. Production has 27 evidence chunk embeddings; live semantic retrieval on the expanded six-case provisional dataset scored P@5 0.300. Session 10's deterministic reranker, Evidence Package persistence, and fenced `build_evidence` Workflow stage are connected and deployed. A fresh authenticated Production analysis completed the full workflow at `stage = complete` on 2026-10-01 (job `2fb0f3e6-deea-4e46-a206-9c330ef9b32f`, generation 2). Claim text is embedded in batches as a retrieval query; the separate `claim_embeddings` table is not populated by this workflow. Session 11 provides a versioned OpenAI judgment provider, strict taxonomy/confidence/output validation, citation membership checks, and fact-check persistence/RLS. Its migration was applied to Production on 2026-10-02. Session 12's fenced `judge_claims` stage, package/claim identity check, and Worker integration are deployed to Production. Expert-reviewed verdict/citation golden cases do not exist, so judgment quality is not established. Session 13 adds /report, which reads persisted judgments and citations; a separate stored report artifact remains unimplemented. The retrieval baseline is small and not human/expert-reviewed, so it is not a quality sign-off. `pnpm evals` runs synthetic contract checks and offline retrieval references; it does not assess live judgment quality.

Session 24 applied the Russian bibliography migration and expanded evidence seed
to Production on 2026-10-03. The current catalog contains 21 sources, 33
passages, and 33 current vectors. Three permission-backed Russian article
passages and one permission-backed SAGE article passage were added; expert
books remain metadata-only until authorized text files are provided. Retrieval
P@5 remained 0.300 across the six provisional cases; this is not an
expert-reviewed quality measure.

Session 12's full-pipeline extension adds live publication discovery through a versioned EvidenceSearchProvider, Europe PMC, and Crossref adapters. Local pgvector retrieval is optional. Europe PMC results are metadata until a PMCID is confirmed in its Open Access subset and the publication's own XML confirms CC BY 4.0. At most one paragraph of 1,000 characters is stored in the existing source/chunk catalog; stable DOI/PMCID keys make retries idempotent. Crossref supplies bibliographic metadata, DOI, and license links only; abstracts and article text are not used. Unknown, non-approved, or missing licenses remain metadata-only references and are excluded from judgment evidence. If APIs fail or no usable passage remains, the Evidence Package records warnings and judgment receives no evidence passage, requiring INSUFFICIENT_EVIDENCE or UNVERIFIABLE. Europe PMC and Crossref coverage is incomplete. This extension was deployed on 2026-10-03 in Worker version `9b3415bf-5f13-4795-ad0c-c5debe5605df`, but live scientific-provider queries have not yet been verified. Model quality remains unverified without expert-reviewed golden cases.

## Contract

```text
Video → Topic Screening → Transcription → Claim Extraction → Claim Normalization
→ Claim Classification → Optional Local Retrieval + Publication Search
→ Item-level OA/License Gate → Metadata Filtering
→ Reranking → Evidence Package → Judgment → Explanation
```

Every stage accepts a typed input, produces a versioned typed output, validates untrusted provider data with Zod, persists enough state for audit/retry, and reports explicit errors. Prompts, schemas, provider/model versions, and evaluation dataset versions should be recorded with analysis metadata.

## Stages

1. **Video:** validate ownership, size, type, and storage reference; never trust file metadata alone.
2. **Topic screening:** videos up to 12 seconds are screened using the full compressed audio track; longer videos use at most three four-second ranges near the start, middle, and end. Mediabunny demuxes/remuxes encoded audio packets without decoding the media. If container metadata omits audio-track duration, duration is computed from packet timestamps. The remuxed sample is capped at 2 MB. Only that sample is sent to OpenAI `whisper-1`; its temporary transcript is classified by `gpt-4o-mini` using strict JSON Schema and Zod validation. A high-confidence off-topic decision is the only result that stops processing. Missing/unsupported audio, unavailable duration, low-confidence output, malformed output, and API errors continue to full transcription. The sample transcript is not persisted; a versioned decision record stores models, instruction version, bounded rationale, reason, confidence, and sample duration.
3. **Transcription:** OpenAI `whisper-1` receives supported MP4/WebM files up to 25 MB. The adapter requests `verbose_json` segment timestamps, validates the untrusted response with Zod, and persists language plus segments under `transcription-v1`. Larger videos currently fail explicitly. See the [OpenAI speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text), [structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs), and [GPT-4o mini model](https://developers.openai.com/api/docs/models/gpt-4o-mini).
4. **Claim extraction, normalization, and classification:** OpenAI returns atomic checkable statements with a source excerpt, standalone normalized statement, claim type, and indexes into the input transcript segments. Server code verifies source tokens against those segments (including Russian `ё`/`е` spelling variation), stores the exact transcript excerpt, and derives timestamps from the transcript rather than trusting model-provided timestamps. Original and normalized wording are both persisted. A failed repair logs only the validation category and job ID, never transcript or model text.
5. **Embedding:** create vectors through `EmbeddingProvider`; record model/version and dimensions. Session 9 fixes the initial provider contract to OpenAI `text-embedding-3-small` (1536 dimensions). Stored content hashes prevent retrieval from using vectors for passages or claims that have since changed.
6. **Retrieval:** Session 9's `match_evidence_chunks_v1` uses cosine distance and returns chunk text plus source identifiers, publication metadata, canonical URL, and similarity score. Only matching model/version vectors whose content hash is current are eligible. Local catalog retrieval is optional; local search failure does not block public API search.
7. **Publication search and rights gate:** Europe PMC and Crossref are searched by normalized claim. Crossref records are metadata-only. Europe PMC full text is requested only for a result marked Open Access in its OA subset; a passage is usable only after the publication's own XML confirms CC BY 4.0. Unknown or incompatible licenses, missing identifiers, and metadata-only records are retained as reference metadata, never evidence. No publisher scraping or paywall bypass occurs. Coverage is incomplete.
8. **Metadata filtering:** the local catalog supports active-source status, passage language, source type, and publication date range. Corrected, retracted, and withdrawn sources are excluded by default. Topic tags are not present in the current catalog and are not accepted as a filter.
9. **Reranking:** Session 10's `evidence-reranking-v1` deterministically combines normalized local cosine similarity (60%) and normalized-claim term coverage (40%), then deduplicates identical passage text and limits selection to two chunks per source and five total. External OA excerpts record provider result order as their retrieval-score kind, not as cosine similarity; they use the same bounded deterministic reranker.
10. **Evidence Package:** Session 10 preserves the claim, selected passage/source provenance, retrieval, external-search and reranking versions, selected chunk IDs, metadata-only references, candidate count, filters, and bounds. It reports `none`, `limited`, or `multi_source` coverage and warnings for missing/narrow evidence. The fenced `build_evidence` stage searches both sources and idempotently persists each package and its chunk links. The stage does not infer a verdict.
11. **Judgment:** the versioned judgment adapter classifies only from a validated Evidence Package using the six-value verdict taxonomy. It treats references as metadata, uses only evidence passages, requires confidence in `[0,1]`, bounded limitations, and citations whose chunk IDs belong to the package. The structured-output schema restricts citation IDs to the current package members (and to no citations for an empty package); server-side membership validation remains mandatory. Evidence-based verdicts require a citation. Judgment prompt, model, and schema versions are saved; retry, run fencing, and immutable citations are unchanged.
12. **Explanation:** state the comparison, qualifications, uncertainty, and citations using only package identifiers.

The current Evidence Base v0 consists of shared `sources` metadata and
licensed, verbatim `evidence_chunks`; see [Evidence Base](EVIDENCE_BASE.md).
Session 9's vector schema, provider, and search repository are implemented;
the migration and live semantic search have been verified against Production.

## Retrieval responsibility

Retrieval answers: **Which stored evidence is most relevant to this claim?** It owns query construction, embeddings, candidate search, filters, reranking, deduplication, and coverage signals. It does not assign a truth verdict.

Public API discovery supplements the local catalog. A successful Crossref or Europe PMC response does not establish full-text availability or reuse rights. Crossref metadata and records with unknown or incompatible licenses cannot support a verdict. Empty or failed searches never imply that a claim is false.

Retrieval output includes candidate identifiers, source metadata, verbatim chunk content, relevance scores, filter/reranker versions, and warnings about limited coverage. Retrieved content is untrusted data. Instructions embedded in it are ignored and delimited from system/developer instructions.

Quality is assessed with precision@k, relevance judgments, coverage, and adversarial retrieval cases. If retrieval is inadequate, judgment must be allowed to return `INSUFFICIENT_EVIDENCE`.

## Report language

Normalized claim formulations, judgment explanations, limitations, and citation rationales are requested in Russian. Exact transcript excerpts and bibliographic source metadata remain in their original language. When a saved judgment is in another language, the report view translates only the normalized formulation and explanation, validates the returned fact-check IDs and Russian text, then caches the rendering in `report_localizations`; immutable verdicts, evidence packages, and citations are not rewritten. The cache is owner-readable and populated through an authorization-checking database function.

## Judgment responsibility

Judgment answers: **Given only this Evidence Package, how does the evidence bear on this normalized claim?** It cannot search, rely on unstated model knowledge, or cite identifiers outside the package. It must distinguish no evidence from contradictory evidence, association from causation, theory from established fact, and historical views from current consensus.

The result includes one permitted verdict, an uncalibrated model confidence, a bounded explanation, cited chunk IDs, and limitations. Code validates the structure, taxonomy, confidence range, and citation membership. A structural success is not automatically a factual success; semantic passage support and verdict quality still require expert-reviewed evals.

## Failure and retry policy

Screening is a cost-saving prefilter, not a truth or claim-extraction stage. Only a validated `unrelated` result at or above the 0.9 confidence threshold with an allowed out-of-scope reason stops processing; every other result fails open. Screening metadata is unique by content item and screening version, so a later workflow generation reuses it. The expanded topic classifier uses `topic-screening-v2`. If a transcript already exists, the workflow bypasses screening and proceeds to claim extraction. A completed job whose initial screening was uncertain is not re-screened by retry; upload the video again to validate a screening-code change. Invalid screening output is recorded as uncertain and never silently accepted. Claim extraction keeps artifact/schema version `claim-extraction-v1` / `claim-extraction-schema-v1` and uses Russian instructions version `claim-extraction-instructions-v3`: it considers neighboring transcript segments, includes only claims directly relevant to the project's declared topic scope, and omits unrelated factual statements. It permits one repair call for malformed or transcript-inconsistent output. It caps transcript text at 100,000 characters and returns an explicit permanent error above that limit; it never truncates silently. Claim extraction rows, including an empty-result marker, are saved idempotently in a single database function. Provider timeout/rate-limit errors may retry with bounded exponential backoff. Permanent errors and exhausted retries persist an actionable job state. Stage outputs use idempotency keys so workflow retries do not duplicate transcripts or claims.

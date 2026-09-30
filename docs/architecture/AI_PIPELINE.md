# AI Pipeline

## Current status

The Cloudflare Workflow screens a bounded audio sample, transcribes relevant or uncertain videos with OpenAI `whisper-1`, then extracts, normalizes, and classifies claims with OpenAI `gpt-4o-mini`. Sessions 6A–7 are implemented locally but have not been verified in Production. Embedding, retrieval, metadata filtering, reranking, Evidence Package creation, judgment, and explanation are not connected. The `pnpm evals` command validates synthetic fixture shape; it is not a model-quality evaluation.

## Contract

```text
Video → Topic Screening → Transcription → Claim Extraction → Claim Normalization
→ Claim Classification → Embedding → Retrieval → Metadata Filtering
→ Reranking → Evidence Package → Judgment → Explanation
```

Every stage accepts a typed input, produces a versioned typed output, validates untrusted provider data with Zod, persists enough state for audit/retry, and reports explicit errors. Prompts, schemas, provider/model versions, and evaluation dataset versions should be recorded with analysis metadata.

## Stages

1. **Video:** validate ownership, size, type, and storage reference; never trust file metadata alone.
2. **Topic screening:** for videos longer than 40 seconds, demux at most three four-second ranges (start, middle, end) from the compressed audio track with Mediabunny, without decoding the media. The remuxed sample is capped at 2 MB. Only those audio samples are sent to OpenAI `whisper-1`; their temporary transcript is classified by `gpt-4o-mini` using strict JSON Schema and Zod validation. A high-confidence off-topic decision is the only result that stops processing. Short videos, missing/unsupported audio, missing duration, low-confidence output, malformed output, and API errors continue to full transcription. The sample transcript is not persisted; a versioned decision record stores models, instruction version, bounded rationale, reason, confidence, and sample duration.
3. **Transcription:** OpenAI `whisper-1` receives supported MP4/WebM files up to 25 MB. The adapter requests `verbose_json` segment timestamps, validates the untrusted response with Zod, and persists language plus segments under `transcription-v1`. Larger videos currently fail explicitly. See the [OpenAI speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text), [structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs), and [GPT-4o mini model](https://developers.openai.com/api/docs/models/gpt-4o-mini).
4. **Claim extraction, normalization, and classification:** OpenAI returns atomic checkable statements with an exact source excerpt, standalone normalized statement, claim type, and indexes into the input transcript segments. Server code verifies each source excerpt against those segments and derives timestamps from the transcript rather than trusting model-provided timestamps. Original and normalized wording are both persisted.
5. **Embedding:** create vectors through `EmbeddingProvider`; record model/version and dimensions.
6. **Retrieval:** obtain a broader candidate set from the Evidence Base.
7. **Metadata filtering:** enforce language, source status, retraction, date, topic, and study-type constraints where appropriate.
8. **Reranking:** score direct relevance to the exact normalized claim; preserve diverse, non-duplicative evidence.
9. **Evidence Package:** freeze the selected chunks, source metadata, scores, and retrieval trace.
10. **Judgment:** classify only from that package using the fixed verdict taxonomy.
11. **Explanation:** state the comparison, qualifications, uncertainty, and citations using only package identifiers.

## Retrieval responsibility

Retrieval answers: **Which stored evidence is most relevant to this claim?** It owns query construction, embeddings, candidate search, filters, reranking, deduplication, and coverage signals. It does not assign a truth verdict.

Retrieval output includes candidate identifiers, source metadata, verbatim chunk content, relevance scores, filter/reranker versions, and warnings about limited coverage. Retrieved content is untrusted data. Instructions embedded in it are ignored and delimited from system/developer instructions.

Quality is assessed with precision@k, relevance judgments, coverage, and adversarial retrieval cases. If retrieval is inadequate, judgment must be allowed to return `INSUFFICIENT_EVIDENCE`.

## Judgment responsibility

Judgment answers: **Given only this Evidence Package, how does the evidence bear on this normalized claim?** It cannot search, rely on unstated model knowledge, or cite identifiers outside the package. It must distinguish no evidence from contradictory evidence, association from causation, theory from established fact, and historical views from current consensus.

The result includes one permitted verdict, calibrated confidence, a bounded explanation, cited chunk IDs, and limitations. Code validates the structure, taxonomy, confidence range, and citation membership. A structural success is not automatically a factual success; evals test evidence/verdict agreement and hallucination.

## Failure and retry policy

Screening is a cost-saving prefilter, not a truth or claim-extraction stage. Only a validated `unrelated` result at or above the 0.9 confidence threshold with an allowed out-of-scope reason stops processing; every other result fails open. Screening metadata is unique by content item and `topic-screening-v1`, so a later workflow generation reuses it. Invalid screening output is recorded as uncertain and never silently accepted. Claim extraction uses the versioned `claim-extraction-v1` prompt/schema and permits one repair call for malformed or transcript-inconsistent output. It caps transcript text at 100,000 characters and returns an explicit permanent error above that limit; it never truncates silently. Claim extraction rows, including an empty-result marker, are saved idempotently in a single database function. Provider timeout/rate-limit errors may retry with bounded exponential backoff. Permanent errors and exhausted retries persist an actionable job state. Stage outputs use idempotency keys so workflow retries do not duplicate transcripts or claims.

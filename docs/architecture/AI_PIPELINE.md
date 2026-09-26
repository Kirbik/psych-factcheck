# AI Pipeline

## Current status

The codebase currently defines TypeScript provider contracts and the verdict union only. No video transcription, claim extraction/normalization/classification, embedding, retrieval, metadata filtering, reranking, Evidence Package creation, judgment, or explanation runtime is wired into the application. The `pnpm evals` command currently validates a synthetic fixture's shape; it is not an AI quality evaluation. The sections below describe the intended future design.

## Contract

```text
Video → Transcription → Claim Extraction → Claim Normalization
→ Claim Classification → Embedding → Retrieval → Metadata Filtering
→ Reranking → Evidence Package → Judgment → Explanation
```

Every stage accepts a typed input, produces a versioned typed output, validates untrusted provider data with Zod, persists enough state for audit/retry, and reports explicit errors. Prompts, schemas, provider/model versions, and evaluation dataset versions should be recorded with analysis metadata.

## Stages

1. **Video:** validate ownership, size, type, and storage reference; never trust file metadata alone.
2. **Transcription:** produce timestamped segments and language metadata through `TranscriptionProvider`.
3. **Claim extraction:** identify standalone checkable statements without judging truth.
4. **Normalization:** preserve meaning while resolving context; retain original text and timestamp.
5. **Classification:** assign a claim type to guide search and evidence standards.
6. **Embedding:** create vectors through `EmbeddingProvider`; record model/version and dimensions.
7. **Retrieval:** obtain a broader candidate set from the Evidence Base.
8. **Metadata filtering:** enforce language, source status, retraction, date, topic, and study-type constraints where appropriate.
9. **Reranking:** score direct relevance to the exact normalized claim; preserve diverse, non-duplicative evidence.
10. **Evidence Package:** freeze the selected chunks, source metadata, scores, and retrieval trace.
11. **Judgment:** classify only from that package using the fixed verdict taxonomy.
12. **Explanation:** state the comparison, qualifications, uncertainty, and citations using only package identifiers.

## Retrieval responsibility

Retrieval answers: **Which stored evidence is most relevant to this claim?** It owns query construction, embeddings, candidate search, filters, reranking, deduplication, and coverage signals. It does not assign a truth verdict.

Retrieval output includes candidate identifiers, source metadata, verbatim chunk content, relevance scores, filter/reranker versions, and warnings about limited coverage. Retrieved content is untrusted data. Instructions embedded in it are ignored and delimited from system/developer instructions.

Quality is assessed with precision@k, relevance judgments, coverage, and adversarial retrieval cases. If retrieval is inadequate, judgment must be allowed to return `INSUFFICIENT_EVIDENCE`.

## Judgment responsibility

Judgment answers: **Given only this Evidence Package, how does the evidence bear on this normalized claim?** It cannot search, rely on unstated model knowledge, or cite identifiers outside the package. It must distinguish no evidence from contradictory evidence, association from causation, theory from established fact, and historical views from current consensus.

The result includes one permitted verdict, calibrated confidence, a bounded explanation, cited chunk IDs, and limitations. Code validates the structure, taxonomy, confidence range, and citation membership. A structural success is not automatically a factual success; evals test evidence/verdict agreement and hallucination.

## Failure and retry policy

Provider timeout/rate-limit errors may retry with bounded exponential backoff when the operation is idempotent. Invalid structured output may receive a small bounded repair attempt but is never silently accepted. Permanent errors and exhausted retries persist an actionable failed job state. Stage outputs use idempotency keys so workflow retries do not duplicate claims, fact checks, or usage events.

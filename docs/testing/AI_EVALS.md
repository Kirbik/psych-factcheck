# AI Evaluation Plan

## Current status

`pnpm evals` validates synthetic fact-check, topic-screening, and claim-extraction fixtures and computes an offline lexical retrieval reference over three initial relevance-labeled queries. The labels have not been expert-reviewed. The lexical reference is P@5 0.467 (per-case 0.400, 0.600, 0.400) over the 23-passage Session 8 seed. The small curated set is not a medical/scientific gold standard. The command does not call OpenAI or measure live embedding retrieval or model quality.

## Golden dataset

The future golden dataset will contain human-reviewed transcripts, expected claim spans and normalized claims, claim types, query/evidence relevance judgments, allowed and forbidden verdicts, required qualifications, and citation constraints. Cases should cover common topics, ambiguity, causal language, conflicting evidence, missing evidence, historical theories, adversarial retrieved text, and distribution slices such as language/audio quality.

Example:

```json
{
  "id": "fact-001",
  "claim": "All depression is caused by low serotonin",
  "expectedVerdicts": ["CONTRADICTED", "OVERSIMPLIFIED"],
  "forbiddenVerdicts": ["SUPPORTED"]
}
```

The repository currently contains one synthetic fixture demonstrating the expected case shape. **Synthetic fixtures are NOT medical ground truth.** They must never be used to claim clinical validity or production quality. Domain experts must review real golden labels and source evidence before release.

`evals/fixtures/retrieval-v1.json` contains three initial query-to-passage relevance sets. Its deterministic lexical P@5 result is a reproducible reference to compare with future retrieval runs; the labels still need expert review, and this tiny sample does not establish broad retrieval quality. A pgvector/OpenAI run against a dedicated test database is still required to record the semantic retriever's P@5.

The screening fixture includes an incidental psychology mention as a false-positive guard, an ambiguous short excerpt as a false-negative guard, and one clear psychology case. These examples document desired behavior only; no model output is scored against them yet.

## Metrics

- Claim extraction precision and recall, including span/context accuracy
- Claim normalization semantic preservation
- Retrieval precision@k, recall/coverage, and evidence relevance
- Citation accuracy and source/chunk traceability
- Verdict agreement, including allowed-verdict sets for legitimately ambiguous cases
- Unsupported citation rate and hallucination rate
- Correlation/causation, absence/contradiction, theory/consensus error rates
- Calibration by confidence band and slice-level regressions

## Runner and release use

Each case and run records dataset, prompt, schema, provider, model, and retrieval-index versions. Deterministic validators first reject malformed output, unknown verdicts, and citations outside the Evidence Package. Scored results compare against a versioned baseline with explicit thresholds; material regressions block release unless reviewed and documented.

AI judges may help exploration but cannot be the sole ground truth. High-risk disagreements receive human review. Do not tune on the hidden evaluation split. Store no copyrighted full text or sensitive user content without an explicit data policy.

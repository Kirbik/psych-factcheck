# AI Evaluation Plan

## Current status

There is no AI quality runner yet. `pnpm evals` validates the synthetic fact-check fixture and the synthetic topic-screening cases in `evals/fixtures/video-screening-cases.json`; it confirms only that demonstration fixtures match their schemas. It does not call OpenAI or measure model quality, false-positive/false-negative rates, or scientific correctness.

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

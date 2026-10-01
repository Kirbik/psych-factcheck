# AI Evaluation Plan

## Current status

`pnpm evals` validates synthetic fact-check, topic-screening, and claim-extraction fixtures and computes an offline lexical retrieval reference over three provisional AI-reviewed queries. The labels were checked against query intent and source passages on 2026-10-01, but have not been human/expert-reviewed. The lexical reference is P@5 0.400 (per-case 0.400, 0.600, 0.200) over the 23-passage Session 8 seed. The small curated set is not a medical/scientific gold standard. The command does not call OpenAI or measure live embedding retrieval or model quality.

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

`evals/fixtures/retrieval-v2.json` contains three provisional AI-reviewed query-to-passage relevance sets. Version 2 excludes the growth-mindset association passage from the intervention query because it is observational rather than intervention evidence. The ego-depletion task-effectiveness passage is retained as a secondary methodological caveat. The deterministic lexical P@5 is a reproducible reference; human/expert review is still needed, and this tiny sample does not establish broad retrieval quality. Production semantic retrieval was measured for Session 9; local pgvector integration coverage still requires a dedicated test database.

`evals/fixtures/fact-check-judgment-v1.json` exercises the Session 11 judgment contract with synthetic accepted and rejected outputs, including empty-evidence handling and fabricated-citation rejection. It does not assess whether a passage semantically supports its assigned verdict. The expert-reviewed golden verdict/citation set required for a judgment quality gate has not yet been created; no verdict-quality claim can be based on this fixture.

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

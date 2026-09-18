# Fact-checking Rules

> **We check the claim, not the person.** The product never infers intent and never says that an author is lying.

## Checkable claims

A checkable claim is a sufficiently specific assertion about the world that relevant empirical, systematic, or authoritative evidence could support, qualify, contradict, or fail to resolve. It should preserve the speaker's material meaning and context.

Examples include causal claims ("X causes Y"), prevalence claims, treatment-effect claims, diagnostic claims, mechanistic claims, and claims about scientific consensus. Claims that combine multiple independently testable propositions should be split without changing meaning.

## What is not a claim

Personal experience, preference, advice without a factual premise, metaphor, value judgment, prediction without testable conditions, rhetorical question, and vague assertion with no stable interpretation are not ordinarily checkable. Opinion is not fact. A first-person experience may contain a checkable generalization, but the personal experience itself should not be disputed.

## Original and normalized claim

`original claim` is the closest faithful excerpt from the transcript, linked to its timestamp. `normalized claim` is a concise, standalone proposition used for retrieval and judgment. Normalization may resolve pronouns and implicit subjects using local context; it must not strengthen modality, introduce causality, broaden a population, or add facts.

Both versions remain visible so users can audit the transformation. Ambiguous transformations should be marked `UNVERIFIABLE` or routed for clarification rather than guessed.

## Claim types

- Descriptive/prevalence: how common or associated something is
- Causal/mechanistic: whether one factor causes or explains another
- Intervention: benefits, harms, or comparative effects
- Diagnostic/classification: symptoms, criteria, or category membership
- Prognostic: expected future outcomes
- Consensus/theory: status of a model or degree of scientific agreement
- Historical: what a person or school proposed at a time

Type affects search strategy and the evidence needed. Correlation is not causation. A historical theory is not current consensus, and a theoretical model is not an established fact.

## Evidence quality

Relevance to the exact population, intervention/exposure, comparator, outcome, and time frame comes first. Prefer current systematic reviews, meta-analyses, high-quality guidelines, preregistered replications, and strong primary studies as appropriate. Consider study design, sample size, risk of bias, directness, consistency, precision, publication date, and retractions/corrections. A prestigious source cannot compensate for irrelevant content.

Retrieved snippets are candidates, not proof. Reranking must retain source identity and enough context to avoid quote mining. Absence of evidence is not evidence of absence unless the search and expected detectability justify that inference.

## Verdict taxonomy

- `SUPPORTED`: high-quality relevant evidence supports the material claim without an important missing qualification.
- `MOSTLY_SUPPORTED`: the central claim is supported, but a limited qualification, scope change, or uncertainty matters.
- `OVERSIMPLIFIED`: the claim compresses a nuanced, conditional, heterogeneous, or multifactorial evidence base in a way that can mislead.
- `INSUFFICIENT_EVIDENCE`: available relevant evidence is too sparse, indirect, weak, or conflicting to decide.
- `CONTRADICTED`: relevant evidence affirmatively conflicts with the material claim. Mere lack of supporting evidence is not contradiction.
- `UNVERIFIABLE`: the statement is not empirically testable, is too ambiguous, is primarily opinion/experience, or cannot be normalized without inventing meaning.

Only these primary verdicts are permitted. Judgment must be reproducible from the supplied Evidence Package; unsupported evidence may not be used to justify a verdict.

## Confidence

Confidence communicates how strongly the available, relevant Evidence Package justifies this classification, considering evidence quality, agreement, directness, and claim clarity. It is not a probability that the speaker is lying, not clinical certainty, and not a substitute for limitations. Calibration rules and thresholds must be versioned and evaluated.

## Citation rules

Every citation must resolve to a real stored source and exact evidence chunk. A cited chunk must appear in the Evidence Package, support the adjacent explanation, retain source metadata, and be presented without changing its meaning. Never fabricate a DOI, title, author, URL, quote, study result, source, or evidence. If traceability fails, remove the assertion or return insufficient evidence—not a guessed citation.

## Limitations and insufficient evidence

Use `INSUFFICIENT_EVIDENCE` when retrieval finds no suitable evidence, only low-quality/indirect evidence, conflicting evidence without a defensible synthesis, evidence for a materially different population/outcome, or too little context to evaluate the claim. Use `UNVERIFIABLE` when the claim itself cannot be tested or faithfully interpreted.

The service is limited by Evidence Base coverage, transcription quality, claim normalization, publication bias, research quality, temporal currency, and model error. It does not replace systematic review, professional clinical judgment, diagnosis, or care. Reports must expose these limitations and allow inspection of sources.

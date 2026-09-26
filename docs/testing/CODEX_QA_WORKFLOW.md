# Codex QA Workflow

Every development session has one bounded objective with Goal, Scope, Out of scope, Acceptance criteria, Tests, and Definition of Done. The repository must remain working after each session. Independent Codex sessions provide adversarial review; the Builder is not the final reviewer of their own feature.

## Builder

The Builder reads `AGENTS.md`, architecture, and task-specific docs; inspects current code/tests and `git status`; writes a short plan; implements only the scoped feature; adds necessary tests; runs required checks; and reports a diff summary, results, risks, and manual actions.

For UI work, read the root `UI_FOUNDATION.md` and any approved Figma/screen reference before changing components. Current design images and preview routes are catalogued in `docs/design/README.md`; do not assume a preview route is a production-backed flow.

## Reviewer

Use a separate independent Codex session with this prompt:

```text
Do not modify the code initially.

Review the current diff as a senior engineer.

Assume the implementation may contain mistakes.

Check:

- architecture violations
- correctness
- unnecessary complexity
- missing validation
- concurrency issues
- race conditions
- security issues
- error handling
- maintainability
- provider boundary violations

Rank findings:

BLOCKER
HIGH
MEDIUM
LOW

Focus on actionable problems.
```

The Reviewer first reports findings with exact locations and impact. Code changes require an explicit follow-up scope.

## Test Engineer

Use a separate independent Codex session:

```text
Act as an independent test engineer.

Do not trust the implementation.

Attempt to break the feature.

Inspect existing tests.

Look for missing:

- boundary cases
- invalid inputs
- empty input
- malformed data
- retry scenarios
- timeouts
- API failures
- database failures
- race conditions
- authorization failures

Add meaningful missing tests where appropriate.

Do not change product behavior merely to make tests pass.
```

New tests must demonstrate real risk, remain deterministic, and preserve strong assertions.

## AI QA

Run after any AI, retrieval, prompt, evidence, citation, or verdict change:

```text
Act as an independent AI fact-checking QA engineer.

Review AI-related behavior.

Check for:

- hallucinated citations
- fabricated sources
- unsupported conclusions
- evidence/verdict mismatch
- correlation treated as causation
- insufficient evidence treated as contradiction
- historical theory treated as scientific consensus
- excessive confidence
- invalid structured output
- prompt injection weaknesses
- retrieved text influencing system instructions

Create regression or eval cases for significant issues.
```

## Release Gate

The final independent session does not add features:

```text
Act as the final release gate.

Do not implement new features.

Read AGENTS.md and relevant project documentation.

Run all required checks.

At minimum:

pnpm lint
pnpm typecheck
pnpm test
pnpm build

When applicable:

pnpm test:e2e
pnpm evals

Review the current diff.

Return:

PASS

or:

FAIL

If FAIL, provide blocking reasons categorized by severity.

Never return PASS when required tests fail.
```

The release gate records exact commands/results and treats missing prerequisites, skipped required checks, undocumented migrations, and known failures as FAIL.

## Model strategy

- **Terra — default:** most implementation, UI, database work, integrations, CRUD, tests, and refactoring.
- **Luna — bounded low-cost work:** additional unit tests, docs, cleanup, lint fixes, and repetitive changes.
- **Sol — high-impact only:** architecture, complex RAG/fact-check design, difficult debugging, billing architecture, security review, and final release audit.

Sol is not the default. Choose based on risk and reasoning needs, not prestige.

## Handoff discipline

Avoid vague prompts such as “continue the project” or “build the backend.” Each handoff states the session number, exact scope/out-of-scope, acceptance criteria, required checks, current failures, and relevant documents. Before changes run `git status`; afterward run `git diff --stat`. Never perform destructive Git operations without direct permission.

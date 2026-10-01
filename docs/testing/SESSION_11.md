# Session 11 verification — Evidence-bound fact-check judgment

## Result

Implemented locally:

- A versioned OpenAI `gpt-4o-mini` judgment provider/service and
  structured-output contract for the six documented verdicts, confidence,
  explanation, limitations, and cited chunk relationships.
- Strict Zod validation for Evidence Packages and judgment results. Citations
  must be unique members of the supplied package. Evidence-based verdicts
  require at least one citation; an empty package permits only
  `INSUFFICIENT_EVIDENCE` or `UNVERIFIABLE`.
- The persistence repository reloads the package by its claim and package IDs
  and rejects a mismatched payload before saving. Table-level writes are
  revoked from both authenticated users and `service_role`; only the validated
  RPC can write.
- A service-role-only persistence RPC and immutable `fact_checks` and
  `fact_check_evidence` records, with package membership checked again in SQL
  and owner-readable RLS.
- Synthetic contract evals for bounded citations, empty evidence, and rejection
  of a fabricated chunk identifier.

The judgment adapter is not connected to the Cloudflare Workflow; full-pipeline
composition belongs to Session 12. Migration
`20261002100000_fact_check_judgments_v1.sql` was applied to Production on
2026-10-02. The linked migration history confirms local and remote versions
match. No live OpenAI judgment or Production persistence run was performed.

## Checks

- `pnpm lint`: PASS; two pre-existing `next/no-location-assign` warnings remain
  in `src/components/preview/history-preview.tsx`.
- `pnpm typecheck`: PASS after regenerating stale Next route types with
  `node node_modules/next/dist/bin/next typegen`.
- `pnpm test`: PASS — 211 passed, 5 skipped; 35 files passed, 3
  environment-gated files skipped. PGlite applied the Session 11 migration and
  exercised save idempotency, citation membership, verdict validation, and
  owner RLS.
- `pnpm evals`: PASS — 4 files and 7 tests. Judgment fixtures are synthetic
  contract cases, not semantic verdict evaluations.
- `pnpm build`: PASS.
- Independent adversarial review: resolved the package/payload binding and
  direct `service_role` DML findings; re-review found no remaining actionable
  code issues. The semantic quality gate below remains open.

## Open quality gate

The repository has no expert-reviewed judgment golden set. The prompt and
adapter can enforce output structure and package citation membership, but
cannot establish that a cited passage semantically supports the conclusion.
Session 11's quality Definition of Done remains open until reviewed verdict
and citation cases are available and pass agreed thresholds. No quality or
clinical-validity claim is made.

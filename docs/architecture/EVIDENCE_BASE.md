# Evidence storage — source search disabled in Session 29

## Current implementation

New workflow runs do not search Europe PMC, Crossref, a local scientific
catalog, or vector embeddings. After claim extraction, the Worker persists an
empty, versioned assessment package and applies the psychology evidence-check
method without using model memory as evidence. Empirical claims save as
`unknown` / `INSUFFICIENT_EVIDENCE` because no publication was reviewed. Claims
and results remain persisted.

Historical package snapshots remain attached to their original judgments and
citations; they are not reprocessed or deleted. Europe PMC/Crossref provider
adapters and tests remain isolated for historical compatibility, but the
Worker no longer invokes them. No scientific publication text is added to new
packages. No paywall bypass or publisher scraping occurs.

Each new check stores an empty Evidence Package with versions
`psychology-skill-no-search-v1` and `no-reranking-v1`; its trace records that no
provider was used. Old checks can still contain bounded and attributable
passages. Reports and historical citations resolve against their exact package
items; RLS derives ownership through the claim and content item.

Package, judgment and prompt versions remain recorded. Retries reuse first saved
artifacts, and new versions are idempotent. Since sources are not checked, no
scientific support or refutation is claimed. Model quality is unconfirmed without
expert-reviewed golden cases.

## Retirement migration and rollout

`20261009120000_retire_local_rag.sql`:

1. Preserves publisher, DOI, license and original rights/provenance in earlier package-item source snapshots;
   original package payloads, claims, judgments and identifiers remain intact.
2. Adds package-scoped citation foreign keys, rejecting citations to other packages.
3. Removes shared `sources`, `evidence_chunks`, `evidence_embeddings`,
   `claim_embeddings`, `import_evidence_seed` and `match_evidence_chunks_v1`.
   Uncited catalog content is removed. The pgvector extension is left untouched.

**Prepared locally, not applied or deployed to Production.** Do not run an old
Worker against the new schema or the new Worker against old catalog foreign keys.
For rollout: back up the catalog/database, pause new analyses and cron dispatch,
drain active runs, apply the reviewed migration and deploy compatible code in the
same maintenance window, then resume dispatch. Verify old reports and a fresh
authenticated analysis. New search versions do not automatically requeue completed
jobs. Restoring only an old Worker is not a sufficient rollback; restore compatible
schema/data from backup. No Production live validation is claimed.

## Historical implementation

Sessions 8–10 introduced the seed, embeddings and local retrieval; Sessions 23–24
expanded that corpus. Session 26 retired the shared catalog, and Session 29
removed the publication API call from the active workflow. Their migrations are
retained in schema history. Earlier read-only package formats remain compatible.

Historical verification:
[Session 8](../testing/SESSION_8.md),
[Session 9](../testing/SESSION_9.md),
[Session 10](../testing/SESSION_10.md),
[Russian source review](RUSSIAN_SOURCES.md).

Stored legacy text retains its prior licensing/permission provenance and its
earlier verdict. The retirement does not reclassify it as new Europe PMC evidence.

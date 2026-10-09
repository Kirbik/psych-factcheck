# Evidence storage — local RAG retired in Session 26

## Current implementation

Evidence discovery uses Europe PMC/Crossref through `EvidenceSearchProvider`.
No local scientific catalog, seed import, vector retrieval or embedding call
remains in the Session 26 runtime. Claims extracted from videos and their
results remain persisted.

Only publication-specific Europe PMC OA subset text with confirmed CC BY 4.0
rights can enter evidence. Crossref contributes bibliographic metadata and links;
its abstracts/full text are never assumed reusable. Unknown/incompatible licenses
remain metadata-only. No paywall bypass or publisher scraping occurs.

Each check stores a bounded Evidence Package with up to five selected passages,
at most 1,000 characters per Europe PMC publication, and necessary attribution:
DOI/PMCID, title, authors/year, URL, data provider/version, OA type and license.
Full articles are not persisted. Stable source/excerpt UUIDs identify snapshots,
not reusable catalog rows. Reports and citations resolve against the exact package
items; RLS derives ownership through the claim and content item.

Search, provider, query trace, reranker, schema, judgment and prompt versions remain
recorded. Retries reuse first saved artifacts. Missing publications cannot imply
refutation. Europe PMC/Crossref coverage, especially licensed full text in Russian
and broad psychology/relationship topics, is incomplete. Contract tests do not
confirm model quality without expert-reviewed golden cases.

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
expanded that corpus. Their migrations are retained in the schema history and
must run before the retirement upgrade on a fresh database. Seed/vector scripts,
runtime modules, generated catalog types and obsolete corpus-specific tests/evals
are removed. Earlier read-only package formats remain compatible.

Historical verification:
[Session 8](../testing/SESSION_8.md),
[Session 9](../testing/SESSION_9.md),
[Session 10](../testing/SESSION_10.md),
[Russian source review](RUSSIAN_SOURCES.md).

Stored legacy text retains its prior licensing/permission provenance and its
earlier verdict. The retirement does not reclassify it as new Europe PMC evidence.

# Evidence Base v0

## Scope

Session 8 adds a small, shared catalog of curated psychology publications and
verbatim evidence passages. It stores publication metadata, current editorial
status, reuse license, passage text, section locator, language, and a SHA-256
digest of the stored text. The Session 8 catalog itself does not retrieve
passages for claims or produce judgments.

The schema migration and initial curated seed were applied to the linked
Production project on 2026-10-01. Session 23 added three open-access sources
and four verbatim passages covering adult relationships, couple
communication, sexual satisfaction, and sexual wellbeing. On 2026-10-03 the
Russian bibliography migration and expanded seed were applied to Production.
It now has 21 sources, 33 chunks, and 33 current evidence vectors, with no
missing source links. Three Russian articles have one permission-backed passage
each; the four expert books remain metadata-only pending provision of their
authorized text files. Session 9's versioned embedding schema and pgvector
search migration were deployed to Production on 2026-10-01. Production has 33
evidence chunk vectors;
the claim-vector table is available but is not populated by the current seed
workflow.

## Tables and access

- `sources` has one stable DOI-derived `source_key` per publication. The unique
  DOI and source key prevent duplicate imports. `status` is `active`,
  `corrected`, `retracted`, or `withdrawn`.
- `evidence_chunks` belongs to a source through a non-null foreign key with
  `ON DELETE RESTRICT`; `(source_id, chunk_key)` is unique. Each passage retains
  its section/abstract locator and content hash.
- RLS permits authenticated users to read the shared catalog. Anonymous reads
  and client writes are denied. Only the service role can call the transactional
  import function.

The service-only `import_evidence_seed` RPC upserts source and chunk rows in one
transaction. A malformed source or a chunk that references an unknown source
rolls back the whole import. Re-running the same seed updates the same stable
rows. A source already marked corrected, retracted, or withdrawn is not silently
reset to active by an old seed.

## Curated seed and licenses

`src/server/evidence/seed-v0.ts` is the reviewed manifest. It now contains 21
publication/book records and 33 short passages. Four expert books remain
metadata-only. Three Russian articles have short passages under a separately
recorded user attestation that legal permission was confirmed; their original
license codes remain unchanged, including one all-rights-reserved record.
Permission provenance records the confirmation date and permitted excerpt
storage, embedding, and LLM retrieval uses. Runtime Zod validation rejects
duplicate identifiers, unknown source references, DOI/ISBN key mismatches,
invalid URLs, and passages without a reusable license or recorded permission.
The importer computes a SHA-256 digest from the exact passage text before
sending it to PostgreSQL.

Migration `20261003100000_russian_bibliography_sources.sql` adds book,
textbook, and monograph records plus an all-rights-reserved metadata-only
license state. ISBN is stored in source provenance. The four books remain
bibliography/context records only because no authorized book files were
available in the repository. Migration, source rows, passages, and embeddings
were verified in Production on 2026-10-03. See
[Russian sources review](RUSSIAN_SOURCES.md)
for bibliographic verification, source selection notes, and limitations.

The seed includes permission-backed passages from one SAGE article, three
Russian articles, and CC BY 4.0 records. Permission-backed passages retain
each source's actual license and
record a distinct permission attestation. Each record stores its license URL
and the date it was checked;
every displayed citation must still attribute the authors, article, and
canonical source URL. Stored passages are verbatim and are not model-generated
summaries. The SQL import also verifies each passage's SHA-256 digest against
its UTF-8 text. Re-check license/status metadata before adding or refreshing a
source.

Import is explicit and never runs during application startup:

```bash
pnpm evidence:seed
```

Before running it, apply the migration to the intended database and inspect
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the local
environment. The command also requires
`EVIDENCE_IMPORT_CONFIRM=IMPORT_EVIDENCE_SEED_V0`; it performs a privileged,
remote-capable database write. It prints only import counts and never prints
credentials or passage contents.

## Session 9 — Embeddings and retrieval

Session 9 added `evidence_embeddings` and `claim_embeddings`, keyed by the source
row and embedding version, with model, dimension, and source-content digest.
The search RPC returns current active-source candidates with chunk and source
provenance and supports language, source type, and publication-date filters.
The expanded seed stores relationship and adult sexual-health tags in source
provenance. They are descriptive only and are not a retrieval filter. Original
passages and source provenance remain canonical. Reranking, Evidence Packages,
and verdicts remain future work.

The explicit `pnpm evidence:embed` command reuses vectors whose source hashes
are current, embeds changed passages, and measures retrieval P@5 against the
small provisional fixture. It requires `OPENAI_API_KEY`, service-role access,
the exact
`EVIDENCE_EMBEDDING_PROJECT_REF`, and `EVIDENCE_EMBEDDING_CONFIRM=EMBED_EVIDENCE_V1`.
The command may perform privileged database writes and external embedding API
calls; inspect the configured Supabase target before running it. Production
retrieval on the expanded dataset v2 scored P@5 0.300 across six cases; this is
not a human-reviewed quality benchmark.

## Next stage

Session 10 implements deterministic reranking and bounded Evidence Package
construction in `src/server/evidence/reranking.ts`. It combines cosine
similarity and normalized-claim term coverage, deduplicates identical passage
text, caps packages at five chunks and two chunks per source, and preserves
source metadata, verbatim text, scores, versions, filters, and candidate/
selection trace. Empty and narrow packages carry explicit coverage warnings.
The `build_evidence` workflow stage batches claim embeddings, retrieves
candidates, and persists packages through `save_evidence_packages`; package
rows and ordered chunk links are idempotent and owner-readable under RLS. The
schema and Worker integration were deployed on 2026-10-01. The provisional
retrieval-v2 eval checks package P@5 against the offline lexical baseline; it
is not an expert-reviewed quality measure.

Session 12 adds a separate judgment stage that consumes the persisted package
and stores a versioned fact check with package-member citations. This integration
is deployed to Production, and a fresh authenticated analysis completed the
workflow through `stage = complete` in generation 2. Do not infer a verdict from
retrieval or the Evidence Package itself.

# Evidence Base v0

## Scope

Session 8 adds a small, shared catalog of curated psychology publications and
verbatim evidence passages. It stores publication metadata, current editorial
status, reuse license, passage text, section locator, language, and a SHA-256
digest of the stored text. The Session 8 catalog itself does not retrieve
passages for claims or produce judgments.

The schema migration and curated seed were applied to the linked Production
project on 2026-10-01. A remote readback confirmed 10 sources, 23 chunks, and
no chunks with missing source rows.
Session 9's versioned embedding schema and pgvector search migration were
deployed to Production on 2026-10-01. Production has 23 evidence chunk vectors;
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

`src/server/evidence/seed-v0.ts` is the reviewed manifest for ten publications
and 23 short passages. Runtime Zod validation rejects duplicate identifiers,
unknown source references, DOI/key mismatches, invalid URLs, and unapproved
license identifiers. The importer computes a SHA-256 digest from the exact
passage text before sending it to PostgreSQL.

The seed includes one metadata-only SAGE record under CC BY-NC 4.0 and article
metadata plus short passages from CC BY 4.0 records. No text passage is stored
for the noncommercial-only publication. Each record stores its license URL and
the date it was checked; every displayed citation must still attribute the
authors, article, and canonical source URL. Stored passages are verbatim and
are not model-generated summaries. The SQL import also verifies each passage's
SHA-256 digest against its UTF-8 text. Re-check license/status metadata before
adding or refreshing a source.

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
Topic metadata is not present in Evidence Base v0. Original passages and source
provenance remain canonical. Reranking, Evidence Packages, and verdicts remain
future work.

The explicit `pnpm evidence:embed` command reuses vectors whose source hashes
are current, embeds changed passages, and measures retrieval P@5 against the
small provisional fixture. It requires `OPENAI_API_KEY`, service-role access,
the exact
`EVIDENCE_EMBEDDING_PROJECT_REF`, and `EVIDENCE_EMBEDDING_CONFIRM=EMBED_EVIDENCE_V1`.
The command may perform privileged database writes and external embedding API
calls; inspect the configured Supabase target before running it. Production
retrieval on dataset v2 scored P@5 0.400 across three cases; this is not a
human-reviewed quality benchmark.

## Next stage

Session 10 adds reranking and bounded Evidence Package construction. It should
compare its results with the provisional retrieval baseline and report coverage
gaps without weakening source traceability.

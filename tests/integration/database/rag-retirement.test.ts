// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { searchExternalPublications } from "@/server/evidence/external-publications";
import { buildEvidencePackage } from "@/server/evidence/reranking";
import {
  validateEvidencePackage,
  validateEvidenceBoundJudgment,
  FACT_CHECK_JUDGMENT_VERSION,
} from "@/server/ai/judgment";
import { createFactCheckService } from "@/server/ai/fact-check-service";
import type {
  EvidencePackage,
  FactCheckJudgment,
  ExtractedClaim,
} from "@/server/ai/providers";

vi.mock("server-only", () => ({}));
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const content = "33333333-3333-4333-8333-333333333333";
const source = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const chunk = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const license = "https://creativecommons.org/licenses/by/4.0/";
const claim: ExtractedClaim = {
  original: "Sleep affects memory.",
  normalized: "Sleep affects memory.",
  startSeconds: 0,
  endSeconds: 3,
  claimType: "causal_mechanistic",
};
const sqlFile = (name: string) =>
  readFile(
    new URL(`../../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
let db: PGlite;
let extractionId: string,
  claimId: string,
  jobId: string,
  legacyPackageId: string,
  legacyCheckId: string;
async function savePackage(pkg: EvidencePackage) {
  return db.query<{ saved: number }>(
    "select public.save_evidence_packages($1,$2,$3,$4::jsonb) as saved",
    [
      extractionId,
      pkg.retrievalVersion,
      pkg.rerankingVersion,
      JSON.stringify([
        {
          claimId,
          retrievalVersion: pkg.retrievalVersion,
          rerankingVersion: pkg.rerankingVersion,
          coverage: pkg.coverage,
          payload: pkg,
        },
      ]),
    ],
  );
}
function judgmentFor(pkg: EvidencePackage): FactCheckJudgment {
  return {
    verdict: "SUPPORTED",
    confidence: 0.7,
    explanation: "The received synthetic passage supports this bounded claim.",
    limitations: ["Mock scientific evidence only."],
    citations: [
      {
        chunkId: pkg.evidence[0].chunkId,
        relation: "supports",
        rationale: "The fixture reports memory effects.",
      },
    ],
  };
}
async function saveCheck(
  pkgId: string,
  judgment: FactCheckJudgment,
  generation = 1,
  runId = "run-1",
  version = FACT_CHECK_JUDGMENT_VERSION,
) {
  return db.query<{ id: string }>(
    "select public.save_fact_check_for_analysis_run($1,$2,$3,$4,$5,$6,'openai','mock-model','mock-prompt','mock-schema',$7::jsonb) as id",
    [
      jobId,
      generation,
      runId,
      claimId,
      pkgId,
      version,
      JSON.stringify(judgment),
    ],
  );
}

describe("retire local RAG while preserving claim results", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
   create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create schema storage; create schema app_private;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as
    'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
   grant usage on schema auth to authenticated,service_role;
   create table storage.buckets(id text primary key,name text,public boolean);
   create table storage.objects(id uuid primary key,bucket_id text,name text);
   create function storage.foldername(text) returns text[] language sql immutable as 'select string_to_array($1,''/'')';
  `);
    for (const name of [
      "20260912000000_initial_foundation.sql",
      "20260913000000_video_upload.sql",
      "20260927100000_analysis_workflow.sql",
      "20260930120000_transcription_v1.sql",
      "20260930140000_video_topic_screening.sql",
      "20260930160000_claim_extraction_v1.sql",
      "20261001100000_evidence_base_v0.sql",
      "20261001140000_evidence_packages_v1.sql",
      "20261002100000_fact_check_judgments_v1.sql",
      "20261002120000_full_pipeline_judgment_stage.sql",
      "20261002130000_fenced_fact_check_persistence.sql",
      "20261002150000_report_localizations_ru.sql",
      "20261003120000_report_narratives.sql",
    ])
      await db.exec(await sqlFile(name));
    await db.query("insert into auth.users values($1),($2)", [owner, other]);
    await db.query(
      "insert into public.content_items(id,user_id,storage_path) values($1,$2,$2::uuid::text||'/video.mp4')",
      [content, owner],
    );
    const transcript = await db.query<{ id: string }>(
      "insert into public.transcripts(content_item_id,provider,model,segments) values($1,'openai','mock','[]') returning id",
      [content],
    );
    const extraction = await db.query<{ id: string }>(
      "select public.save_claim_extraction($1,'claim-extraction-v1','openai','mock','mock-prompt','mock-schema',$2::jsonb) as id",
      [transcript.rows[0].id, JSON.stringify([claim])],
    );
    extractionId = extraction.rows[0].id;
    claimId = (
      await db.query<{ id: string }>(
        "select id from public.claims where claim_extraction_id=$1",
        [extractionId],
      )
    ).rows[0].id;
    jobId = (
      await db.query<{ id: string }>(
        "select id from public.analysis_jobs where content_item_id=$1",
        [content],
      )
    ).rows[0].id;
    await db.query(
      "update public.analysis_jobs set status='running',run_id='run-1',stage='judge_claims' where id=$1",
      [jobId],
    );
    await db.query(
      `insert into public.sources(id,source_key,title,authors,journal,publisher,published_at,doi,canonical_url,source_type,license_code,license_url)
   values($1,'doi:10.0000/legacy','Synthetic legacy study',array['Mock Author'],'Mock Journal','Mock Publisher','2024-01-01','10.0000/legacy','https://example.org/legacy','journal_article','CC-BY-4.0',$2)`,
      [source, license],
    );
    await db.query(
      `insert into public.evidence_chunks(id,source_id,chunk_key,content,locator,language,content_sha256)
   values($1,$2,'legacy-excerpt','Sleep affected memory in this synthetic legacy study.','Results','en',repeat('a',64))`,
      [chunk, source],
    );
    await db.query(
      "update public.sources set provenance=$1::jsonb where id=$2",
      [
        JSON.stringify({
          license_verified_at: "2024-01-01",
          rights_permission: {
            basis: "user_attested_legal_permission",
            confirmedAt: "2024-01-01",
            uses: ["store_excerpts", "create_embeddings", "retrieve_for_llm"],
          },
        }),
        source,
      ],
    );
    const legacy: EvidencePackage = {
      claim,
      evidence: [
        {
          sourceId: source,
          chunkId: chunk,
          chunkKey: "legacy-excerpt",
          text: "Sleep affected memory in this synthetic legacy study.",
          language: "en",
          locator: "Results",
          source: {
            key: "doi:10.0000/legacy",
            title: "Synthetic legacy study",
            authors: ["Mock Author"],
            journal: "Mock Journal",
            publishedAt: "2024-01-01",
            type: "journal_article",
            canonicalUrl: "https://example.org/legacy",
          },
          retrievalScore: 0.8,
          relevanceScore: 0.9,
        },
      ],
      retrievalVersion: "evidence-retrieval-v2",
      rerankingVersion: "evidence-reranking-v1",
      coverage: "limited",
      warnings: ["limited_evidence_coverage"],
      trace: {
        retrieval: {
          provider: "openai",
          model: "legacy",
          embeddingVersion: "legacy-v1",
          filters: {
            sourceStatus: "active",
            language: null,
            sourceTypes: null,
            publishedAfter: null,
            publishedBefore: null,
            limit: 20,
          },
        },
        candidateCount: 1,
        selectedChunkIds: [chunk],
        maximumEvidence: 5,
        maximumChunksPerSource: 2,
      },
    };
    await savePackage(legacy);
    legacyPackageId = (
      await db.query<{ id: string }>(
        "select id from public.evidence_packages where claim_id=$1",
        [claimId],
      )
    ).rows[0].id;
    legacyCheckId = (
      await saveCheck(
        legacyPackageId,
        judgmentFor(legacy),
        1,
        "run-1",
        "fact-check-judgment-v1",
      )
    ).rows[0].id;
    // PGlite has no pgvector. Structural stand-ins exercise teardown dependencies;
    // actual vector DDL and Production upgrade are not verified by this test.
    await db.exec(`
   create table public.evidence_embeddings(evidence_chunk_id uuid references public.evidence_chunks(id));
   create table public.claim_embeddings(claim_id uuid references public.claims(id));
   create function public.match_evidence_chunks_v1(text,text,text,text,text[],date,date,integer)
    returns setof public.evidence_chunks language sql as 'select * from public.evidence_chunks where false';
  `);
    await db.exec(await sqlFile("20261009120000_retire_local_rag.sql"));
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });

  it("removes catalog tables and import/retrieval RPCs while preserving old claims and citations", async () => {
    for (const name of [
      "sources",
      "evidence_chunks",
      "evidence_embeddings",
      "claim_embeddings",
    ]) {
      expect(
        (
          await db.query<{ name: string | null }>(
            "select to_regclass($1)::text as name",
            ["public." + name],
          )
        ).rows[0].name,
      ).toBeNull();
    }
    expect(
      (
        await db.query<{ name: string | null }>(
          "select to_regprocedure($1)::text as name",
          ["public.import_evidence_seed(jsonb,jsonb)"],
        )
      ).rows[0].name,
    ).toBeNull();
    expect(
      (
        await db.query<{ name: string | null }>(
          "select to_regprocedure($1)::text as name",
          [
            "public.match_evidence_chunks_v1(text,text,text,text,text[],date,date,integer)",
          ],
        )
      ).rows[0].name,
    ).toBeNull();
    expect(
      (await db.query("select id from public.claims where id=$1", [claimId]))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query("select id from public.fact_checks where id=$1", [
          legacyCheckId,
        ])
      ).rows,
    ).toHaveLength(1);
    const item = (
      await db.query<{ snapshot: { source: Record<string, unknown> } }>(
        "select snapshot from public.evidence_package_items where evidence_package_id=$1",
        [legacyPackageId],
      )
    ).rows[0];
    expect(
      (
        await db.query<{
          legacy_provenance: {
            source: { rights_permission: { basis: string } };
          };
        }>(
          "select legacy_provenance from public.evidence_package_items where evidence_package_id=$1",
          [legacyPackageId],
        )
      ).rows[0].legacy_provenance.source.rights_permission.basis,
    ).toBe("user_attested_legal_permission");
    expect(item.snapshot.source).toMatchObject({
      publisher: "Mock Publisher",
      doi: "10.0000/legacy",
      licenseCode: "CC-BY-4.0",
      licenseUrl: license,
    });
    expect(
      (
        await db.query(
          "select evidence_package_id,evidence_chunk_id from public.fact_check_evidence where fact_check_id=$1",
          [legacyCheckId],
        )
      ).rows,
    ).toEqual([
      { evidence_package_id: legacyPackageId, evidence_chunk_id: chunk },
    ]);
  });

  it("runs mocked API search to a saved fenced judgment without a catalog, with idempotent retries", async () => {
    const search = vi.fn(async () => [
      {
        title: "Synthetic API study",
        doi: "10.0000/new",
        pmcid: "PMC12345",
        authors: ["Mock Author"],
        journal: "Mock Journal",
        publisher: "Mock Publisher",
        year: "2024",
        publicationType: "Journal Article",
        fullTextLanguage: "en",
        url: "https://europepmc.org/articles/PMC12345",
        licenseUrl: license,
        fullText:
          "Sleep affected memory performance in this synthetic API fixture. ".repeat(
            30,
          ),
        provider: "europe-pmc" as const,
      },
    ]);
    const [retrieval] = await searchExternalPublications(
      { version: "mock-scientific-v1", search },
      [claim.normalized],
    );
    const pkg = validateEvidencePackage(
      await buildEvidencePackage(claim, retrieval),
    );
    expect((await savePackage(pkg)).rows[0].saved).toBe(1);
    expect((await savePackage(pkg)).rows[0].saved).toBe(0);
    const pkgId = (
      await db.query<{ id: string }>(
        "select id from public.evidence_packages where claim_id=$1 and retrieval_version=$2",
        [claimId, pkg.retrievalVersion],
      )
    ).rows[0].id;
    const judge = vi.fn(async (received: EvidencePackage) =>
      judgmentFor(received),
    );
    const service = createFactCheckService(
      {
        async getEvidencePackage(id, pid) {
          const rows = await db.query<{ payload: unknown }>(
            "select payload from public.evidence_packages where id=$1 and claim_id=$2",
            [pid, id],
          );
          return validateEvidencePackage(rows.rows[0].payload);
        },
        async save(metadata, received, judgment) {
          const validated = validateEvidenceBoundJudgment(
            received,
            judgment,
          ).judgment;
          return (
            await saveCheck(
              metadata.evidencePackageId,
              validated,
              metadata.generation,
              metadata.runId,
            )
          ).rows[0].id;
        },
      },
      {
        provider: "openai",
        model: "mock-model",
        judgmentVersion: FACT_CHECK_JUDGMENT_VERSION,
        instructionsVersion: "mock-prompt",
        schemaVersion: "mock-schema",
        judge,
      },
    );
    const input = {
      claimId,
      evidencePackageId: pkgId,
      jobId,
      generation: 1,
      runId: "run-1",
    };
    const id = await service.judgeAndSave(input);
    expect(await service.judgeAndSave(input)).toBe(id);
    expect(judge.mock.calls[0][0]).toEqual(pkg);
    expect(
      (
        await db.query(
          "select id from public.fact_checks where evidence_package_id=$1",
          [pkgId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select id from public.evidence_packages where claim_id=$1 and retrieval_version=$2",
          [claimId, pkg.retrievalVersion],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select * from public.fact_check_evidence where fact_check_id=$1",
          [id],
        )
      ).rows,
    ).toHaveLength(1);
    const stored = JSON.stringify(
      (
        await db.query(
          "select payload from public.evidence_packages where id=$1",
          [pkgId],
        )
      ).rows,
    );
    expect(stored).not.toContain("fullText");
    expect(pkg.evidence[0].text).toHaveLength(1000);
    await expect(
      service.judgeAndSave({ ...input, generation: 2 }),
    ).rejects.toThrow(/no longer current/);
    await expect(
      service.judgeAndSave({ ...input, runId: "old-run" }),
    ).rejects.toThrow(/no longer current/);
    await expect(
      saveCheck(pkgId, {
        ...judgmentFor(pkg),
        citations: [
          { chunkId: chunk, relation: "supports", rationale: "Wrong package" },
        ],
      }),
    ).rejects.toThrow(/outside evidence package/);
    // Even a direct write cannot attach an existing legacy chunk to another package.
    await expect(
      db.query(
        "insert into public.fact_check_evidence(fact_check_id,evidence_package_id,evidence_chunk_id,ordinal,relation,rationale) values($1,$2,$3,1,'supports','Wrong package')",
        [id, pkgId, chunk],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("rejects unlicensed and unbounded publication text in the SQL boundary", async () => {
    const legacy = (
      await db.query<{ payload: EvidencePackage }>(
        "select payload from public.evidence_packages where id=$1",
        [legacyPackageId],
      )
    ).rows[0].payload;
    for (const text of ["x".repeat(1001), "", "Short fixture"]) {
      const invalid: EvidencePackage = {
        ...legacy,
        schemaVersion: "evidence-package-v2",
        retrievalVersion: "publication-search-v1",
        rerankingVersion: "invalid-guard-test",
        evidence: legacy.evidence.map((item) => ({ ...item, text })),
      };
      await expect(savePackage(invalid)).rejects.toThrow(/not licensed/);
    }
    const empty = {
      ...legacy,
      retrievalVersion: "publication-search-v1",
      rerankingVersion: "invalid-schema-test",
      evidence: [],
      coverage: "none" as const,
    };
    await expect(savePackage(empty)).rejects.toThrow(/schema/);
  });

  it("keeps package and citation audit data owner-only and RPCs service-only", async () => {
    for (const user of [owner, other]) {
      await db.exec("begin;set local role authenticated;");
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          user,
        ]);
        const packages = await db.query(
          "select * from public.evidence_packages",
        );
        const items = await db.query(
          "select * from public.evidence_package_items",
        );
        const checks = await db.query("select * from public.fact_checks");
        const citations = await db.query(
          "select * from public.fact_check_evidence",
        );
        for (const rows of [
          packages.rows,
          items.rows,
          checks.rows,
          citations.rows,
        ]) {
          if (user === owner) expect(rows.length).toBeGreaterThan(0);
          else expect(rows).toEqual([]);
        }
        await expect(
          db.query(
            "select public.save_evidence_packages($1,'x','x','[]'::jsonb)",
            [extractionId],
          ),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("rollback");
      }
    }
  });
});

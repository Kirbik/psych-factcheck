// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const contentId = "33333333-3333-4333-8333-333333333333";
const screenedOutContentId = "66666666-6666-4666-8666-666666666666";
const judgmentStageContentId = "99999999-9999-4999-8999-999999999999";
const sqlFile = (name: string) =>
  readFile(
    new URL(`../../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
let db: PGlite;

describe("analysis workflow SQL (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    // Minimal Supabase-owned schemas; application DDL below is the actual migration.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema app_private;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth to authenticated, service_role;
      create table storage.buckets (id text primary key, name text, public boolean);
      create table storage.objects (id uuid primary key, bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql immutable as 'select string_to_array($1, ''/'')';
    `);
    await db.exec(await sqlFile("20260912000000_initial_foundation.sql"));
    await db.exec(await sqlFile("20260913000000_video_upload.sql"));
    await db.exec(await sqlFile("20260927100000_analysis_workflow.sql"));
    await db.exec(await sqlFile("20260930120000_transcription_v1.sql"));
    await db.exec(await sqlFile("20260930140000_video_topic_screening.sql"));
    await db.exec(
      await sqlFile("20261002160000_relationship_sexual_health_topics.sql"),
    );
    await db.exec(`insert into auth.users values ('${owner}'), ('${other}');
      insert into public.content_items(id, user_id, storage_path)
        values ('${contentId}', '${owner}', '${owner}/video.mp4'),
          ('${screenedOutContentId}', '${owner}', '${owner}/screened.mp4'),
          ('${judgmentStageContentId}', '${owner}', '${owner}/judgment-stage.mp4');
      update public.analysis_jobs set status = 'completed', stage = 'complete',
        completed_at = now() where content_item_id = '${contentId}';
      update public.analysis_jobs set status = 'completed', stage = 'complete',
        error_code = 'VIDEO_OUT_OF_SCOPE', completed_at = now()
        where content_item_id = '${screenedOutContentId}';`);
    await db.exec(await sqlFile("20260930160000_claim_extraction_v1.sql"));
    await db.exec(await sqlFile("20261001100000_evidence_base_v0.sql"));
    await db.exec(await sqlFile("20261001140000_evidence_packages_v1.sql"));
    await db.exec(await sqlFile("20261002100000_fact_check_judgments_v1.sql"));
    await db.exec(
      await sqlFile("20261002120000_full_pipeline_judgment_stage.sql"),
    );
    await db.exec(
      await sqlFile("20261002130000_fenced_fact_check_persistence.sql"),
    );
    await db.exec(await sqlFile("20261002150000_report_localizations_ru.sql"));
  }, 30_000);
  afterAll(async () => {
    await db?.close();
  });

  async function asUser<T>(id: string, work: () => Promise<T>) {
    await db.exec("begin; set local role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      id,
    ]);
    try {
      return await work();
    } finally {
      await db.exec("rollback");
    }
  }
  async function request(retry: number | null = null) {
    const result = await db.query<{
      id: string;
      generation: number;
      status: string;
      run_id: string | null;
    }>("select * from public.request_analysis_job($1, $2)", [contentId, retry]);
    return result.rows[0];
  }
  async function transition(
    id: string,
    generation: number,
    run: string,
    status: string,
  ) {
    return db.query<{ status: string; stage: string }>(
      "select * from public.advance_analysis_job($1, $2, $3, $4)",
      [id, generation, run, status],
    );
  }

  it("deduplicates starts, prevents user-written transitions and cross-owner access", async () => {
    await asUser(owner, async () => {
      const first = await request();
      expect((await request()).id).toBe(first.id);
      expect(first.generation).toBe(1);
      await expect(
        transition(first.id, 1, "run_1", "completed"),
      ).rejects.toThrow(/permission denied/);
    });
    await asUser(other, async () => {
      await expect(request()).rejects.toThrow(/Content not found/);
    });
  });

  it("requeues completed transcription jobs under the claim-extraction pipeline", async () => {
    const result = await db.query<{
      content_item_id: string;
      status: string;
      pipeline_version: string;
    }>(
      `select content_item_id, status, pipeline_version from public.analysis_jobs
       where content_item_id in ($1, $2) order by content_item_id`,
      [contentId, screenedOutContentId],
    );
    expect(result.rows).toEqual([
      {
        content_item_id: contentId,
        status: "queued",
        pipeline_version: "claim-extraction-v1",
      },
      {
        content_item_id: screenedOutContentId,
        status: "completed",
        pipeline_version: "claim-extraction-v1",
      },
    ]);
  });

  it("uses generation/run fencing, monotonic state and idempotent retries", async () => {
    await db.exec("begin; set local role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      owner,
    ]);
    const job = await request();
    await db.exec("set local role service_role");
    expect(
      (await transition(job.id, 1, "run_1", "running")).rows[0].stage,
    ).toBe("validate_upload");
    expect((await transition(job.id, 1, "run_other", "running")).rows).toEqual(
      [],
    );
    expect((await transition(job.id, 1, "run_1", "queued")).rows).toEqual([]);
    expect(
      (await transition(job.id, 1, "run_1", "failed")).rows[0].status,
    ).toBe("failed");
    await db.exec("set local role authenticated");
    expect((await request()).status).toBe("failed");
    const retried = await request(1);
    expect(retried).toMatchObject({
      id: job.id,
      generation: 2,
      status: "queued",
      run_id: null,
    });
    expect((await request(1)).generation).toBe(2);
    await db.exec("set local role service_role");
    expect((await transition(job.id, 1, "run_1", "completed")).rows).toEqual(
      [],
    );
    await transition(job.id, 2, "run_2", "running");
    expect(
      (await transition(job.id, 2, "run_2", "completed")).rows[0],
    ).toMatchObject({ status: "completed", stage: "complete" });
    expect((await transition(job.id, 2, "run_2", "failed")).rows).toEqual([]);
    const content = await db.query<{ status: string }>(
      "select status from public.content_items where id = $1",
      [contentId],
    );
    expect(content.rows[0].status).toBe("pending");
    await db.exec("rollback");
  });

  it("allows the judgment stage only through the fenced stage RPC", async () => {
    const job = await db.query<{ id: string; generation: number }>(
      "select id, generation from public.analysis_jobs where content_item_id = $1",
      [judgmentStageContentId],
    );
    const jobId = job.rows[0]?.id;
    expect(jobId).toBeTruthy();
    await db.query(
      `update public.analysis_jobs set status = 'running', run_id = 'session12-run'
       where id = $1`,
      [jobId],
    );
    const stage = await db.query<{ set_analysis_job_stage: boolean }>(
      "select public.set_analysis_job_stage($1, 1, 'session12-run', 'judge_claims', 1)",
      [jobId],
    );
    expect(stage.rows[0]?.set_analysis_job_stage).toBe(true);
    expect(
      await db.query<{ stage: string }>(
        "select stage from public.analysis_jobs where id = $1",
        [jobId],
      ),
    ).toMatchObject({ rows: [{ stage: "judge_claims" }] });
    await expect(
      db.query(
        "select public.set_analysis_job_stage($1, 1, 'session12-run', 'unknown_stage', 1)",
        [jobId],
      ),
    ).rejects.toThrow(/Invalid analysis stage/);
  });

  it("keeps RLS status reads private and rejects anonymous enqueue", async () => {
    await db.exec("begin; set local role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      owner,
    ]);
    await request();
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      other,
    ]);
    expect((await db.query("select * from public.analysis_jobs")).rows).toEqual(
      [],
    );
    await db.exec("set local role anon");
    await expect(request()).rejects.toThrow(/permission denied/);
    await db.exec("rollback");
  });

  it("stores one immutable versioned transcript and exposes it only to its owner", async () => {
    const created = await db.query<{ id: string }>(
      `insert into public.transcripts(content_item_id, provider, model, language, segments)
       values ($1, 'openai', 'whisper-1', 'ru', '[{"startSeconds":0,"endSeconds":1,"text":"текст"}]')
       returning id`,
      [contentId],
    );
    await db.query(
      `insert into public.transcripts(content_item_id, provider, model, language, segments)
       values ($1, 'openai', 'whisper-1', 'en', '[]')
       on conflict (content_item_id, pipeline_version) do nothing`,
      [contentId],
    );
    const rows = await asUser(owner, () =>
      db.query(
        "select id, language from public.transcripts where content_item_id = $1",
        [contentId],
      ),
    );
    expect(rows.rows).toEqual([{ id: created.rows[0]?.id, language: "ru" }]);
    const hidden = await asUser(other, () =>
      db.query("select * from public.transcripts where content_item_id = $1", [
        contentId,
      ]),
    );
    expect(hidden.rows).toEqual([]);
  });

  it("persists an idempotent claim extraction, including an empty result, with owner-only reads", async () => {
    const transcript = await db.query<{ id: string }>(
      "select id from public.transcripts where content_item_id = $1",
      [contentId],
    );
    const emptyResultContentId = "55555555-5555-4555-8555-555555555555";
    await db.query(
      `insert into public.content_items(id, user_id, storage_path)
       values ($1, $2, null)`,
      [emptyResultContentId, owner],
    );
    const emptyResultTranscript = await db.query<{ id: string }>(
      `insert into public.transcripts(content_item_id, provider, model, language, segments)
       values ($1, 'openai', 'whisper-1', 'ru', '[]') returning id`,
      [emptyResultContentId],
    );
    const transcriptId = transcript.rows[0]?.id;
    expect(transcriptId).toBeTruthy();
    await db.exec("begin; set local role service_role");
    const claims = [
      {
        original: "Недосып ухудшает память.",
        normalized: "Недосып ухудшает память.",
        startSeconds: 0,
        endSeconds: 2,
        claimType: "causal_mechanistic",
      },
    ];
    const first = await db.query<{ save_claim_extraction: string }>(
      "select public.save_claim_extraction($1, $2, $3, $4, $5, $6, $7::jsonb)",
      [
        transcriptId,
        "claim-extraction-v1",
        "openai",
        "gpt-4o-mini",
        "instructions-v1",
        "schema-v1",
        JSON.stringify(claims),
      ],
    );
    await db.query(
      "select public.save_claim_extraction($1, $2, $3, $4, $5, $6, $7::jsonb)",
      [
        transcriptId,
        "claim-extraction-v1",
        "openai",
        "gpt-4o-mini",
        "instructions-v1",
        "schema-v1",
        "[]",
      ],
    );
    const emptyExtraction = await db.query<{ save_claim_extraction: string }>(
      "select public.save_claim_extraction($1, $2, $3, $4, $5, $6, $7::jsonb)",
      [
        emptyResultTranscript.rows[0]?.id,
        "claim-extraction-v1",
        "openai",
        "gpt-4o-mini",
        "instructions-v1",
        "schema-v1",
        "[]",
      ],
    );
    const extractionId = first.rows[0]?.save_claim_extraction;
    const stored = await db.query(
      "select original_text, claim_type from public.claims where claim_extraction_id = $1",
      [extractionId],
    );
    expect(stored.rows).toEqual([
      {
        original_text: "Недосып ухудшает память.",
        claim_type: "causal_mechanistic",
      },
    ]);
    expect(
      (
        await db.query(
          "select id from public.claim_extractions where id = $1",
          [emptyExtraction.rows[0]?.save_claim_extraction],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select id from public.claims where claim_extraction_id = $1",
          [emptyExtraction.rows[0]?.save_claim_extraction],
        )
      ).rows,
    ).toEqual([]);

    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      owner,
    ]);
    expect((await db.query("select * from public.claims")).rows).toHaveLength(
      1,
    );
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      other,
    ]);
    expect((await db.query("select * from public.claims")).rows).toEqual([]);
    await db.exec("rollback");
  });

  it("fences stage changes by generation and workflow run", async () => {
    await db.exec("begin; set local role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      owner,
    ]);
    const job = await request();
    await db.exec("set local role service_role");
    await transition(job.id, 1, "run_stage", "running");
    const stage = await db.query<{ updated: boolean }>(
      "select public.set_analysis_job_stage($1, $2, $3, $4, $5) as updated",
      [job.id, 1, "run_stage", "screen_video", 2],
    );
    expect(stage.rows[0]?.updated).toBe(true);
    const stale = await db.query<{ updated: boolean }>(
      "select public.set_analysis_job_stage($1, $2, $3, $4, $5) as updated",
      [job.id, 2, "old_run", "validate_upload", 1],
    );
    expect(stale.rows[0]?.updated).toBe(false);
    await db.exec("rollback");
  });

  it("saves versioned evidence packages atomically, idempotently, and owner-only", async () => {
    const packageContentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const evidenceChunkId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db.query(
      `insert into public.content_items(id, user_id, storage_path)
       values ($1, $2, $2::uuid::text || '/package.mp4')`,
      [packageContentId, owner],
    );
    const transcript = await db.query<{ id: string }>(
      `insert into public.transcripts(content_item_id, provider, model, language, segments)
       values ($1, 'openai', 'whisper-1', 'en', '[]') returning id`,
      [packageContentId],
    );
    await db.exec("set role service_role");
    const extraction = await db.query<{ extraction_id: string }>(
      `select public.save_claim_extraction(
        $1, 'claim-extraction-v1', 'openai', 'gpt-4o-mini', 'instructions-v1', 'schema-v1',
        '[{"original":"Stress impairs memory.","normalized":"Stress impairs memory.","startSeconds":0,"endSeconds":1,"claimType":"causal_mechanistic"}]'::jsonb
      ) as extraction_id`,
      [transcript.rows[0]?.id],
    );
    const claim = await db.query<{ id: string }>(
      "select id from public.claims where claim_extraction_id = $1",
      [extraction.rows[0]?.extraction_id],
    );
    const source = await db.query<{ id: string }>(
      `insert into public.sources
       (source_key, title, authors, journal, publisher, published_at, doi, canonical_url,
        source_type, status, license_code, license_url)
       values ('doi:10.0000/package', 'Stress and memory', array['A. Author'],
        'Example Journal', 'Example Publisher', '2024-01-01', '10.0000/package',
        'https://example.org/study', 'journal_article', 'active', 'CC-BY-4.0',
        'https://creativecommons.org/licenses/by/4.0/') returning id`,
    );
    await db.query(
      `insert into public.evidence_chunks
       (id, source_id, chunk_key, content, locator, language, content_sha256)
       values ($1, $2, 'memory-result', 'Stress impaired memory performance in this study.',
        'Abstract > Results', 'en', repeat('a', 64))`,
      [evidenceChunkId, source.rows[0]?.id],
    );
    const evidenceItem = {
      sourceId: source.rows[0]?.id,
      chunkId: evidenceChunkId,
      chunkKey: "memory-result",
      text: "Stress impaired memory performance in this study.",
      language: "en",
      locator: "Abstract > Results",
      source: {
        key: "doi:10.0000/package",
        title: "Stress and memory",
        authors: ["A. Author"],
        journal: "Example Journal",
        publishedAt: "2024-01-01",
        type: "journal_article",
        canonicalUrl: "https://example.org/study",
      },
      retrievalScore: 0.8,
      relevanceScore: 0.95,
    };
    const evidencePackage = {
      claim: {
        original: "Stress impairs memory.",
        normalized: "Stress impairs memory.",
        startSeconds: 0,
        endSeconds: 1,
        claimType: "causal_mechanistic",
      },
      evidence: [evidenceItem],
      retrievalVersion: "evidence-retrieval-v1",
      rerankingVersion: "evidence-reranking-v1",
      coverage: "limited",
      warnings: ["limited_evidence_coverage"],
      trace: {
        candidateCount: 1,
        selectedChunkIds: [evidenceChunkId],
        maximumEvidence: 5,
        maximumChunksPerSource: 2,
      },
    };
    const packageInput = [
      {
        claimId: claim.rows[0]?.id,
        retrievalVersion: "evidence-retrieval-v1",
        rerankingVersion: "evidence-reranking-v1",
        coverage: "limited",
        payload: evidencePackage,
      },
    ];
    const save = () =>
      db.query<{ saved: number }>(
        `select public.save_evidence_packages($1, $2, $3, $4::jsonb) as saved`,
        [
          extraction.rows[0]?.extraction_id,
          "evidence-retrieval-v1",
          "evidence-reranking-v1",
          JSON.stringify(packageInput),
        ],
      );
    expect((await save()).rows[0]?.saved).toBe(1);
    expect((await save()).rows[0]?.saved).toBe(0);
    const evidencePackageRow = await db.query<{ id: string }>(
      "select id from public.evidence_packages where claim_id = $1",
      [claim.rows[0]?.id],
    );
    const factCheckInput = {
      verdict: "SUPPORTED",
      confidence: 0.72,
      explanation: "The passage supports the bounded claim.",
      limitations: ["Only one source was retrieved."],
      citations: [
        {
          chunkId: evidenceChunkId,
          relation: "supports",
          rationale: "The passage reports the same result.",
        },
      ],
    };
    const analysisJob = await db.query<{ id: string; generation: number }>(
      "select id, generation from public.analysis_jobs where content_item_id = $1",
      [packageContentId],
    );
    await transition(analysisJob.rows[0]!.id, 1, "judgment_run", "running");
    await db.query(
      "select public.set_analysis_job_stage($1, 1, 'judgment_run', 'judge_claims', 1)",
      [analysisJob.rows[0]?.id],
    );
    const saveFactCheck = (
      judgment = factCheckInput,
      generation = 1,
      runId = "judgment_run",
    ) =>
      db.query<{ id: string }>(
        `select public.save_fact_check_for_analysis_run(
          $1, $2, $3, $4, $5, 'fact-check-judgment-v1', 'openai', 'gpt-4o-mini',
          'instructions-v1', 'schema-v1', $6::jsonb
        ) as id`,
        [
          analysisJob.rows[0]?.id,
          generation,
          runId,
          claim.rows[0]?.id,
          evidencePackageRow.rows[0]?.id,
          JSON.stringify(judgment),
        ],
      );
    const savedFactCheck = await saveFactCheck();
    expect(savedFactCheck.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await saveFactCheck()).rows[0]?.id).toBe(
      savedFactCheck.rows[0]?.id,
    );
    const localizedPayload = JSON.stringify([
      {
        fact_check_id: savedFactCheck.rows[0]?.id,
        claim_id: claim.rows[0]?.id,
        normalized_text: "Стресс ухудшает память.",
        explanation: "Данные исследования подтверждают это утверждение.",
      },
    ]);
    await db.exec("begin; set local role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      owner,
    ]);
    await db.query(
      `select public.save_report_localizations_ru(
        $1::jsonb, 'gpt-4o-mini', 'report-localization-ru-v1'
      )`,
      [localizedPayload],
    );
    await db.exec("commit");
    expect(
      await asUser(owner, async () =>
        db.query<{ explanation: string }>(
          "select explanation from public.report_localizations where fact_check_id = $1",
          [savedFactCheck.rows[0]?.id],
        ),
      ),
    ).toMatchObject({
      rows: [
        { explanation: "Данные исследования подтверждают это утверждение." },
      ],
    });
    await expect(
      asUser(other, async () =>
        db.query(
          `select public.save_report_localizations_ru(
            $1::jsonb, 'gpt-4o-mini', 'report-localization-ru-v1'
          )`,
          [localizedPayload],
        ),
      ),
    ).rejects.toThrow(/not authorized/);
    await expect(
      saveFactCheck(factCheckInput, 1, "obsolete_run"),
    ).rejects.toThrow(/Analysis run is no longer current/);
    expect(
      (
        await saveFactCheck({
          ...factCheckInput,
          explanation:
            "A conflicting retry must not change the saved judgment.",
        })
      ).rows[0]?.id,
    ).toBe(savedFactCheck.rows[0]?.id);
    expect(
      await db.query<{ explanation: string }>(
        "select explanation from public.fact_checks where id = $1",
        [savedFactCheck.rows[0]?.id],
      ),
    ).toMatchObject({
      rows: [{ explanation: "The passage supports the bounded claim." }],
    });
    await expect(
      saveFactCheck({
        ...factCheckInput,
        citations: [
          {
            ...factCheckInput.citations[0],
            chunkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          },
        ],
      }),
    ).rejects.toThrow(/outside evidence package/);
    await expect(
      saveFactCheck({
        ...factCheckInput,
        verdict: "UNVERIFIABLE",
        citations: [],
      }),
    ).resolves.toBeDefined();
    await expect(
      saveFactCheck({ ...factCheckInput, verdict: "UNSUPPORTED" }),
    ).rejects.toThrow(/Invalid fact-check judgment fields/);
    expect(
      await db.query<{ count: string }>(
        "select count(*)::text as count from public.evidence_package_items",
      ),
    ).toMatchObject({ rows: [{ count: "1" }] });

    await db.exec("reset role");
    const ownerPackages = await asUser(owner, async () => ({
      packages: await db.query("select payload from public.evidence_packages"),
      items: await db.query(
        "select snapshot from public.evidence_package_items",
      ),
      judgments: await db.query("select verdict from public.fact_checks"),
      citations: await db.query(
        "select evidence_chunk_id from public.fact_check_evidence",
      ),
    }));
    expect(ownerPackages.packages.rows).toHaveLength(1);
    expect(ownerPackages.items.rows).toHaveLength(1);
    expect(ownerPackages.judgments.rows).toHaveLength(1);
    expect(ownerPackages.citations.rows).toHaveLength(1);
    expect(
      await db.query<{
        serviceInsert: boolean;
        serviceUpdate: boolean;
        serviceDelete: boolean;
        citationInsert: boolean;
        citationUpdate: boolean;
        citationDelete: boolean;
      }>(
        `select has_table_privilege('service_role', 'public.fact_checks', 'insert') as "serviceInsert",
          has_table_privilege('service_role', 'public.fact_checks', 'update') as "serviceUpdate",
          has_table_privilege('service_role', 'public.fact_checks', 'delete') as "serviceDelete",
          has_table_privilege('service_role', 'public.fact_check_evidence', 'insert') as "citationInsert",
          has_table_privilege('service_role', 'public.fact_check_evidence', 'update') as "citationUpdate",
          has_table_privilege('service_role', 'public.fact_check_evidence', 'delete') as "citationDelete"`,
      ),
    ).toMatchObject({
      rows: [
        {
          serviceInsert: false,
          serviceUpdate: false,
          serviceDelete: false,
          citationInsert: false,
          citationUpdate: false,
          citationDelete: false,
        },
      ],
    });
    const otherPackages = await asUser(other, async () => ({
      packages: await db.query("select * from public.evidence_packages"),
      items: await db.query("select * from public.evidence_package_items"),
      judgments: await db.query("select * from public.fact_checks"),
      citations: await db.query("select * from public.fact_check_evidence"),
    }));
    expect(otherPackages.packages.rows).toEqual([]);
    expect(otherPackages.items.rows).toEqual([]);
    expect(otherPackages.judgments.rows).toEqual([]);
    expect(otherPackages.citations.rows).toEqual([]);
  });

  it("stores one diagnostic screening result per version without giving users access", async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'video_screenings'`,
    );
    expect(columns.rows.map(({ column_name }) => column_name)).not.toContain(
      "sample_transcript",
    );
    expect(
      await db.query<{ allowed: boolean }>(
        "select has_table_privilege('authenticated', 'public.video_screenings', 'select') as allowed",
      ),
    ).toMatchObject({ rows: [{ allowed: false }] });

    await db.exec("set role service_role");
    await db.query(
      `insert into public.video_screenings
       (content_item_id, screening_version, provider, sample_model, classifier_model,
        instructions_version, decision, reason_code, confidence, rationale, sample_duration_seconds)
       values ($1, 'topic-screening-v2', 'openai', 'whisper-1', 'gpt-4o-mini',
        'topic-screening-instructions-v2', 'relevant', 'target_topics_present', 0.95,
        'Relationship topics are present in the sample.', 12)
       on conflict (content_item_id, screening_version) do nothing`,
      [contentId],
    );
    await db.query(
      `insert into public.video_screenings
       (content_item_id, screening_version, provider, sample_model, classifier_model,
        instructions_version, decision, reason_code, confidence, rationale, sample_duration_seconds)
       values ($1, 'topic-screening-v2', 'openai', 'whisper-1', 'gpt-4o-mini',
        'topic-screening-instructions-v2', 'uncertain', 'unclear_sample', 0,
        'Duplicate attempt.', 12)
       on conflict (content_item_id, screening_version) do nothing`,
      [contentId],
    );
    const rows = await db.query<{ count: string }>(
      `select count(*)::text as count from public.video_screenings
       where content_item_id = $1 and screening_version = 'topic-screening-v2'`,
      [contentId],
    );
    expect(rows.rows[0]?.count).toBe("1");
    await db.exec("reset role");
  });
});

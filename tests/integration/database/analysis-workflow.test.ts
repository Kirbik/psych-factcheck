// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const contentId = "33333333-3333-4333-8333-333333333333";
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
    await db.exec(`insert into auth.users values ('${owner}'), ('${other}');
      insert into public.content_items(id, user_id, storage_path) values ('${contentId}', '${owner}', '${owner}/video.mp4');`);
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

  it("atomically queues an upload before any UI or enqueue request", async () => {
    const result = await db.query<{ status: string; pipeline_version: string }>(
      "select status, pipeline_version from public.analysis_jobs where content_item_id = $1",
      [contentId],
    );
    expect(result.rows).toEqual([
      { status: "queued", pipeline_version: "transcription-v1" },
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
       values ($1, 'topic-screening-v1', 'openai', 'whisper-1', 'gpt-4o-mini',
        'topic-screening-instructions-v1', 'uncertain', 'unclear_sample', 0,
        'Short samples are unclear.', 12)
       on conflict (content_item_id, screening_version) do nothing`,
      [contentId],
    );
    await db.query(
      `insert into public.video_screenings
       (content_item_id, screening_version, provider, sample_model, classifier_model,
        instructions_version, decision, reason_code, confidence, rationale, sample_duration_seconds)
       values ($1, 'topic-screening-v1', 'openai', 'whisper-1', 'gpt-4o-mini',
        'topic-screening-instructions-v1', 'uncertain', 'unclear_sample', 0,
        'Duplicate attempt.', 12)
       on conflict (content_item_id, screening_version) do nothing`,
      [contentId],
    );
    const rows = await db.query<{ count: string }>(
      `select count(*)::text as count from public.video_screenings
       where content_item_id = $1 and screening_version = 'topic-screening-v1'`,
      [contentId],
    );
    expect(rows.rows[0]?.count).toBe("1");
    await db.exec("reset role");
  });
});

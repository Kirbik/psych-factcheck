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
    const result = await db.query<{ status: string }>(
      "select status from public.analysis_jobs where content_item_id = $1",
      [contentId],
    );
    expect(result.rows).toEqual([{ status: "queued" }]);
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
});

// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evidenceSeedV0, toImportRows } from "@/server/evidence/seed-v0";

let db: PGlite;
const migration = readFile(
  new URL(
    "../../../supabase/migrations/20261001100000_evidence_base_v0.sql",
    import.meta.url,
  ),
  "utf8",
);
const rows = toImportRows(evidenceSeedV0);

describe("Evidence Base v0 SQL (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      create function public.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at = now(); return new; end;
      $$;
      grant usage on schema public to anon, authenticated, service_role;
      grant usage on schema auth to authenticated, service_role;
    `);
    await db.exec(await migration);
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  async function importSeed(sources = rows.sources, chunks = rows.chunks) {
    return db.query<{ source_count: number; chunk_count: number }>(
      "select * from public.import_evidence_seed($1::jsonb, $2::jsonb)",
      [JSON.stringify(sources), JSON.stringify(chunks)],
    );
  }

  it("imports the curated seed idempotently with traceable foreign keys", async () => {
    const first = await importSeed();
    expect(first.rows).toEqual([
      {
        source_count: evidenceSeedV0.sources.length,
        chunk_count: evidenceSeedV0.chunks.length,
      },
    ]);
    const second = await importSeed();
    expect(second.rows).toEqual(first.rows);

    const counts = await db.query<{
      sources: number;
      chunks: number;
      missing_sources: number;
    }>(`
      select
        (select count(*)::integer from public.sources) as sources,
        (select count(*)::integer from public.evidence_chunks) as chunks,
        (select count(*)::integer from public.evidence_chunks c
          left join public.sources s on s.id = c.source_id where s.id is null) as missing_sources
    `);
    expect(counts.rows[0]).toEqual({
      sources: evidenceSeedV0.sources.length,
      chunks: evidenceSeedV0.chunks.length,
      missing_sources: 0,
    });
  });

  it("rejects unknown chunk sources and rolls the whole import back", async () => {
    const alteredSources = structuredClone(rows.sources);
    alteredSources[0]!.title = "Uncommitted title change";
    const brokenChunks = structuredClone(rows.chunks);
    brokenChunks[0]!.source_key = "doi:10.0000/not-seeded";
    await expect(importSeed(alteredSources, brokenChunks)).rejects.toThrow(
      /unknown source/,
    );

    const source = await db.query<{ title: string }>(
      "select title from public.sources where source_key = $1",
      [rows.sources[0]!.source_key],
    );
    expect(source.rows[0]!.title).toBe(rows.sources[0]!.title);
  });

  it("rejects null payloads and incorrect content hashes", async () => {
    await expect(
      db.query("select * from public.import_evidence_seed(null, $1::jsonb)", [
        JSON.stringify(rows.chunks),
      ]),
    ).rejects.toThrow(/Invalid evidence source payload/);
    await expect(
      db.query("select * from public.import_evidence_seed($1::jsonb, null)", [
        JSON.stringify(rows.sources),
      ]),
    ).rejects.toThrow(/Invalid evidence chunk payload/);

    const tamperedChunks = structuredClone(rows.chunks);
    tamperedChunks[0]!.content_sha256 = "0".repeat(64);
    await expect(importSeed(rows.sources, tamperedChunks)).rejects.toThrow(
      /content hash mismatch/,
    );
    const count = await db.query<{ chunks: number }>(
      "select count(*)::integer as chunks from public.evidence_chunks",
    );
    expect(count.rows[0]!.chunks).toBe(evidenceSeedV0.chunks.length);
  });

  it("preserves a curator-set retracted status across a repeat seed import", async () => {
    const key = rows.sources[0]!.source_key;
    await db.query(
      "update public.sources set status = 'retracted' where source_key = $1",
      [key],
    );
    await importSeed();
    const result = await db.query<{ status: string }>(
      "select status from public.sources where source_key = $1",
      [key],
    );
    expect(result.rows[0]!.status).toBe("retracted");
  });

  it("allows authenticated catalog reads, denies anonymous reads, and blocks client writes", async () => {
    await db.exec("begin; set local role authenticated;");
    try {
      expect(
        (await db.query("select id from public.sources")).rows,
      ).toHaveLength(evidenceSeedV0.sources.length);
      expect(
        (await db.query("select id from public.evidence_chunks")).rows,
      ).toHaveLength(evidenceSeedV0.chunks.length);
      await expect(
        db.query("insert into public.sources(source_key) values ('bad')"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("rollback");
    }

    await db.exec("begin; set local role anon;");
    try {
      await expect(db.query("select id from public.sources")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.exec("rollback");
    }

    await db.exec("begin; set local role anon;");
    try {
      await expect(
        db.query("select id from public.evidence_chunks"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("rollback");
    }

    const rpcPrivileges = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(`
      select
        has_function_privilege('anon', 'public.import_evidence_seed(jsonb,jsonb)', 'execute') as anon,
        has_function_privilege('authenticated', 'public.import_evidence_seed(jsonb,jsonb)', 'execute') as authenticated,
        has_function_privilege('service_role', 'public.import_evidence_seed(jsonb,jsonb)', 'execute') as service_role
    `);
    expect(rpcPrivileges.rows[0]).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    });
  });
});

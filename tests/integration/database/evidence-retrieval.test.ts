// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.SUPABASE_TEST_DB_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
let pool: Pool | undefined;

const model = "text-embedding-3-small";
const version = "openai-text-embedding-3-small-1536-v1";
const vector = `[1,${Array.from({ length: 1535 }, () => 0).join(",")}]`;

describeDatabase("pgvector evidence retrieval v1", () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("returns only current, active, metadata-matching candidates in cosine order", async () => {
    const client = await pool!.connect();
    const sourceId = randomUUID();
    const chunkId = randomUUID();
    const content =
      "A test passage for retrieval that preserves provenance and source metadata.";
    const contentHash = createHash("sha256")
      .update(content, "utf8")
      .digest("hex");

    try {
      await client.query("begin");
      const extension = await client.query<{ extname: string }>(
        "select extname from pg_extension where extname = 'vector'",
      );
      expect(extension.rows).toEqual([{ extname: "vector" }]);
      const index = await client.query<{ indexname: string }>(
        "select indexname from pg_indexes where schemaname = 'public' and indexname = 'evidence_embeddings_hnsw_cosine_idx'",
      );
      expect(index.rows).toEqual([
        { indexname: "evidence_embeddings_hnsw_cosine_idx" },
      ]);

      await client.query(
        `insert into public.sources
          (id, source_key, title, authors, journal, publisher, published_at, doi,
           canonical_url, source_type, status, license_code, license_url)
         values ($1, $2, 'Retrieval test source', array['Test Author'], 'Test Journal',
           'Test Publisher', '2024-01-01', $3, 'https://example.org/test',
           'meta_analysis', 'active', 'CC-BY-4.0', 'https://creativecommons.org/licenses/by/4.0/')`,
        [sourceId, `test:${sourceId}`, `10.9999/${sourceId}`],
      );
      await client.query(
        `insert into public.evidence_chunks
          (id, source_id, chunk_key, content, locator, language, content_sha256)
         values ($1, $2, 'result', $3, 'Abstract > Results', 'en', $4)`,
        [chunkId, sourceId, content, contentHash],
      );
      await client.query(
        `insert into public.evidence_embeddings
          (evidence_chunk_id, provider, model, embedding_version, dimensions, content_sha256, embedding)
         values ($1, 'openai', $2, $3, 1536, $4, $5::extensions.vector)`,
        [chunkId, model, version, contentHash, vector],
      );

      const found = await client.query<{
        chunk_id: string;
        source_key: string;
        similarity: number;
      }>(
        `select chunk_id, source_key, similarity
         from public.match_evidence_chunks_v1($1, $2, $3, 'en', array['meta_analysis'], '2020-01-01', '2025-01-01', 10)`,
        [vector, model, version],
      );
      expect(found.rows).toEqual([
        { chunk_id: chunkId, source_key: `test:${sourceId}`, similarity: 1 },
      ]);

      await client.query(
        "update public.sources set status = 'withdrawn' where id = $1",
        [sourceId],
      );
      const withdrawn = await client.query(
        "select chunk_id from public.match_evidence_chunks_v1($1, $2, $3, null, null, null, null, 10)",
        [vector, model, version],
      );
      expect(withdrawn.rows).toEqual([]);
      await client.query(
        "update public.sources set status = 'active' where id = $1",
        [sourceId],
      );

      await client.query(
        "update public.evidence_chunks set content = $2 where id = $1",
        [chunkId, `${content} updated`],
      );
      const stale = await client.query(
        "select chunk_id from public.match_evidence_chunks_v1($1, $2, $3, null, null, null, null, 10)",
        [vector, model, version],
      );
      expect(stale.rows).toEqual([]);

      await expect(
        client.query(
          "select * from public.match_evidence_chunks_v1($1, 'unsupported-model', $2, null, null, null, null, 10)",
          [vector, version],
        ),
      ).rejects.toThrow(/Unsupported embedding model or version/);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });
});

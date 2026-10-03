import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "@/server/ai/providers";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_PROVIDER,
  EMBEDDING_VERSION,
} from "@/server/ai/embeddings";
import { searchEvidence, searchEvidenceBatch } from "@/server/evidence/search";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.25);

function provider(overrides: Partial<EmbeddingProvider> = {}) {
  return {
    provider: EMBEDDING_PROVIDER,
    model: EMBEDDING_MODEL,
    version: EMBEDDING_VERSION,
    dimensions: EMBEDDING_DIMENSIONS,
    embed: vi.fn(async () => [vector]),
    ...overrides,
  } as EmbeddingProvider;
}

function result() {
  return {
    chunk_id: "11111111-1111-4111-8111-111111111111",
    source_id: "22222222-2222-4222-8222-222222222222",
    chunk_key: "main-result",
    content: "A traceable evidence passage of sufficient length.",
    language: "en",
    locator: "Abstract > Results",
    source_key: "doi:10.0000/example",
    title: "Example study",
    authors: ["A. Author"],
    journal: "Example Journal",
    published_at: "2024-01-01",
    source_type: "meta_analysis",
    canonical_url: "https://example.org/study",
    similarity: 0.82,
  };
}

describe("evidence search", () => {
  it("embeds the claim, forwards safe metadata filters, and returns source provenance", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [result()], error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    const embeddings = provider();

    const found = await searchEvidence(
      client,
      embeddings,
      "A normalized claim",
      {
        language: "en",
        sourceTypes: ["meta_analysis", "systematic_review"],
        publishedAfter: "2010-01-01",
        limit: 5,
      },
    );

    expect(embeddings.embed).toHaveBeenCalledWith(["A normalized claim"]);
    expect(rpc).toHaveBeenCalledWith(
      "match_evidence_chunks_v1",
      expect.objectContaining({
        p_embedding_model: EMBEDDING_MODEL,
        p_embedding_version: EMBEDDING_VERSION,
        p_language: "en",
        p_source_types: ["meta_analysis", "systematic_review"],
        p_published_after: "2010-01-01",
        p_published_before: null,
        p_match_count: 5,
      }),
    );
    expect(found).toMatchObject({
      retrievalVersion: "evidence-retrieval-v2",
      filters: { sourceStatus: "active", language: "en", limit: 5 },
      candidates: [
        {
          chunkKey: "main-result",
          source: {
            key: "doi:10.0000/example",
            canonicalUrl: "https://example.org/study",
          },
          similarity: 0.82,
        },
      ],
      warnings: [],
    });
  });

  it("rejects unsupported versions and invalid filters before the database query", async () => {
    const rpc = vi.fn();
    const client = { rpc } as unknown as SupabaseClient<Database>;

    await expect(
      searchEvidence(client, provider({ version: "other-version" }), "claim"),
    ).rejects.toMatchObject({ code: "EMBEDDING_MODEL_VERSION_UNSUPPORTED" });
    await expect(
      searchEvidence(client, provider(), "claim", {
        publishedAfter: "2025-01-01",
        publishedBefore: "2020-01-01",
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_SEARCH_INPUT_INVALID" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects untrusted provider and database output and reports empty coverage", async () => {
    const wrongDimension = provider({ embed: vi.fn(async () => [[1, 2, 3]]) });
    const client = { rpc: vi.fn() } as unknown as SupabaseClient<Database>;
    await expect(
      searchEvidence(client, wrongDimension, "claim"),
    ).rejects.toMatchObject({ code: "EMBEDDING_DIMENSION_MISMATCH" });

    const badRpc = vi.fn().mockResolvedValue({
      data: [{ ...result(), source_id: "bad" }],
      error: null,
    });
    const badClient = { rpc: badRpc } as unknown as SupabaseClient<Database>;
    await expect(
      searchEvidence(badClient, provider(), "claim"),
    ).rejects.toMatchObject({
      code: "EVIDENCE_SEARCH_RESPONSE_INVALID",
    });

    const emptyClient = {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as SupabaseClient<Database>;
    await expect(
      searchEvidence(emptyClient, provider(), "claim"),
    ).resolves.toMatchObject({
      candidates: [],
      warnings: ["no_matching_evidence"],
    });
  });

  it("embeds claim batches once and returns one ordered retrieval result per claim", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [result()], error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    const embeddings = provider({ embed: vi.fn(async () => [vector, vector]) });

    const found = await searchEvidenceBatch(client, embeddings, [
      "claim one",
      "claim two",
    ]);

    expect(embeddings.embed).toHaveBeenCalledExactlyOnceWith([
      "claim one",
      "claim two",
    ]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(found.map(({ candidates }) => candidates[0]?.chunkKey)).toEqual([
      "main-result",
      "main-result",
    ]);
  });

  it("rejects a partial batch response before searching", async () => {
    const rpc = vi.fn();
    const client = { rpc } as unknown as SupabaseClient<Database>;
    const embeddings = provider({ embed: vi.fn(async () => [vector]) });

    await expect(
      searchEvidenceBatch(client, embeddings, ["claim one", "claim two"]),
    ).rejects.toMatchObject({ code: "EMBEDDING_RESPONSE_INVALID" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

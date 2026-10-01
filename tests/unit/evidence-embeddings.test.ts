import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "@/server/ai/providers";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_PROVIDER,
  EMBEDDING_VERSION,
} from "@/server/ai/embeddings";
import { embedClaims, embedEvidenceChunks } from "@/server/evidence/embeddings";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

function provider(overrides: Partial<EmbeddingProvider> = {}) {
  return {
    provider: EMBEDDING_PROVIDER,
    model: EMBEDDING_MODEL,
    version: EMBEDDING_VERSION,
    dimensions: EMBEDDING_DIMENSIONS,
    embed: vi.fn(async (texts: readonly string[]) => texts.map(() => vector)),
    ...overrides,
  } as EmbeddingProvider;
}

function client() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ upsert }));
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    upsert,
  };
}

describe("persisted embeddings", () => {
  it("stores current passage digests with provider/version metadata", async () => {
    const database = client();
    await embedEvidenceChunks(database.client, provider(), [
      { id: "chunk-1", content: "The exact evidence text to be embedded." },
    ]);

    expect(database.from).toHaveBeenCalledWith("evidence_embeddings");
    expect(database.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          evidence_chunk_id: "chunk-1",
          provider: EMBEDDING_PROVIDER,
          model: EMBEDDING_MODEL,
          embedding_version: EMBEDDING_VERSION,
          dimensions: EMBEDDING_DIMENSIONS,
          content_sha256: createHash("sha256")
            .update("The exact evidence text to be embedded.", "utf8")
            .digest("hex"),
          embedding: expect.stringMatching(/^\[0\.1,0\.1,/),
        }),
      ],
      { onConflict: "evidence_chunk_id,embedding_version" },
    );
  });

  it("stores normalized claim text under the claim identity", async () => {
    const database = client();
    await embedClaims(database.client, provider(), [
      { id: "claim-1", normalizedText: "A claim text." },
    ]);

    expect(database.from).toHaveBeenCalledWith("claim_embeddings");
    expect(database.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ claim_id: "claim-1", dimensions: 1536 })],
      { onConflict: "claim_id,embedding_version" },
    );
  });

  it("rejects unsupported providers and invalid vectors before persistence", async () => {
    const database = client();
    await expect(
      embedEvidenceChunks(
        database.client,
        provider({ version: "new-version" }),
        [{ id: "chunk-1", content: "Evidence text." }],
      ),
    ).rejects.toMatchObject({ code: "EMBEDDING_MODEL_VERSION_UNSUPPORTED" });
    await expect(
      embedClaims(
        database.client,
        provider({ embed: vi.fn(async () => [[1, 2, 3]]) }),
        [{ id: "claim-1", normalizedText: "A claim." }],
      ),
    ).rejects.toMatchObject({ code: "EMBEDDING_DIMENSION_MISMATCH" });
    expect(database.upsert).not.toHaveBeenCalled();
  });
});

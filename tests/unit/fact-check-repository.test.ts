import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { factCheckRepository } from "@/server/ai/fact-check-repository";
import type { EvidencePackage } from "@/server/ai/providers";
import type { Database } from "@/types/database";

const claimId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const packageId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const chunkId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createEvidencePackage(passageText: string): EvidencePackage {
  return {
    claim: {
      original: "A claim about memory.",
      normalized: "A claim about memory.",
      startSeconds: 0,
      endSeconds: 1,
      claimType: "causal_mechanistic",
    },
    evidence: [
      {
        sourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        chunkId,
        chunkKey: "passage-1",
        text: passageText,
        language: "en",
        locator: "Abstract",
        source: {
          key: "doi:10.0000/example",
          title: "Example source",
          authors: ["Example Author"],
          journal: "Example Journal",
          publishedAt: "2024-01-01",
          type: "journal_article",
          canonicalUrl: "https://example.org/source",
        },
        retrievalScore: 0.8,
        relevanceScore: 0.9,
      },
    ],
    retrievalVersion: "evidence-retrieval-v1",
    rerankingVersion: "evidence-reranking-v1",
    coverage: "limited",
    warnings: [],
    trace: {
      retrieval: {
        provider: "openai",
        model: "text-embedding-3-small",
        embeddingVersion: "evidence-embedding-v1",
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
      selectedChunkIds: [chunkId],
      maximumEvidence: 5,
      maximumChunksPerSource: 2,
    },
  };
}

const judgment = {
  verdict: "SUPPORTED" as const,
  confidence: 0.8,
  explanation: "The passage supports the claim.",
  limitations: [],
  citations: [
    {
      chunkId,
      relation: "supports" as const,
      rationale: "The passage reports the same result.",
    },
  ],
};

function repositoryWithPersistedPackage(persistedPackage: EvidencePackage) {
  const packageQuery = {
    select: vi.fn(() => packageQuery),
    eq: vi.fn(() => packageQuery),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { claim_id: claimId, payload: persistedPackage },
      error: null,
    }),
  };
  const rpc = vi.fn().mockResolvedValue({
    data: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    error: null,
  });
  const client = {
    from: vi.fn(() => packageQuery),
    rpc,
  } as unknown as SupabaseClient<Database>;
  return { repository: factCheckRepository(client), packageQuery, rpc };
}

const metadata = {
  claimId,
  evidencePackageId: packageId,
  judgmentVersion: "fact-check-judgment-v1",
  provider: "openai",
  model: "gpt-4o-mini",
  instructionsVersion: "fact-check-judgment-instructions-v1",
  schemaVersion: "fact-check-judgment-schema-v1",
};

describe("fact-check repository", () => {
  it("binds persistence to the exact package payload already stored for the claim", async () => {
    const savedPackage = createEvidencePackage(
      "The persisted passage reports an association.",
    );
    const changedPackage = createEvidencePackage(
      "A different passage with the same chunk identifier.",
    );
    const { repository, packageQuery, rpc } =
      repositoryWithPersistedPackage(savedPackage);

    await expect(
      repository.save(metadata, changedPackage, judgment),
    ).rejects.toThrow("Judgment evidence package mismatch");
    expect(packageQuery.eq).toHaveBeenCalledWith("id", packageId);
    expect(packageQuery.eq).toHaveBeenCalledWith("claim_id", claimId);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends a judgment only after loading and validating the persisted package", async () => {
    const savedPackage = createEvidencePackage(
      "The persisted passage reports an association.",
    );
    const { repository, rpc } = repositoryWithPersistedPackage(savedPackage);

    await expect(
      repository.save(metadata, savedPackage, judgment),
    ).resolves.toBe("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(rpc).toHaveBeenCalledWith(
      "save_fact_check",
      expect.objectContaining({
        p_claim_id: claimId,
        p_evidence_package_id: packageId,
        p_judgment: expect.objectContaining({ verdict: "SUPPORTED" }),
      }),
    );
  });
});

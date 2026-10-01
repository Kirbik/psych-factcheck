import { describe, expect, it, vi } from "vitest";
import { createFactCheckService } from "@/server/ai/fact-check-service";
import type { VersionedJudgmentProvider } from "@/server/ai/openai-judgment-provider";
import type { EvidencePackage } from "@/server/ai/providers";

const packageData: EvidencePackage = {
  claim: {
    original: "A claim about memory.",
    normalized: "A claim about memory.",
    startSeconds: 0,
    endSeconds: 1,
    claimType: "causal_mechanistic",
  },
  evidence: [],
  retrievalVersion: "evidence-retrieval-v1",
  rerankingVersion: "evidence-reranking-v1",
  coverage: "none",
  warnings: ["no_matching_evidence"],
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
    candidateCount: 0,
    selectedChunkIds: [],
    maximumEvidence: 5,
    maximumChunksPerSource: 2,
  },
};

describe("fact-check service", () => {
  it("judges the package loaded by its claim/package IDs and persists with provider versions", async () => {
    const judgment = {
      verdict: "INSUFFICIENT_EVIDENCE" as const,
      confidence: 0.95,
      explanation: "No relevant passages were retrieved.",
      limitations: ["The package contains no evidence."],
      citations: [],
    };
    const repository = {
      getEvidencePackage: vi.fn().mockResolvedValue(packageData),
      save: vi.fn().mockResolvedValue("ffffffff-ffff-4fff-8fff-ffffffffffff"),
    };
    const provider: VersionedJudgmentProvider = {
      provider: "openai",
      model: "gpt-4o-mini",
      judgmentVersion: "fact-check-judgment-v1",
      instructionsVersion: "fact-check-judgment-instructions-v1",
      schemaVersion: "fact-check-judgment-schema-v1",
      judge: vi.fn().mockResolvedValue(judgment),
    };
    const service = createFactCheckService(repository, provider);

    await expect(
      service.judgeAndSave({
        claimId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        evidencePackageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        jobId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        generation: 3,
        runId: "workflow-run-3",
      }),
    ).resolves.toBe("ffffffff-ffff-4fff-8fff-ffffffffffff");

    expect(provider.judge).toHaveBeenCalledWith(packageData);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        judgmentVersion: "fact-check-judgment-v1",
        provider: "openai",
        model: "gpt-4o-mini",
      }),
      packageData,
      judgment,
    );
    expect(
      repository.getEvidencePackage.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(provider.judge).mock.invocationCallOrder[0] ?? Infinity,
    );
  });
});

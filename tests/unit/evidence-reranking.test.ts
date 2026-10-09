import { describe, expect, it, vi } from "vitest";
import type { ExtractedClaim } from "@/server/ai/providers";
import {
  buildEvidencePackage,
  deterministicEvidenceReranker,
  EvidenceRerankingError,
} from "@/server/evidence/reranking";
import type { EvidenceCandidate } from "@/server/evidence/search";

const retrievalMetadata = {
  retrievalVersion: "evidence-retrieval-v1",
  provider: "europe-pmc+crossref",
  model: "publication-search",
  filters: {
    sourceStatus: "active" as const,
    language: null,
    sourceTypes: null,
    publishedAfter: null,
    publishedBefore: null,
    limit: 10,
  },
};

vi.mock("server-only", () => ({}));

const claim: ExtractedClaim = {
  original: "Does stress impair memory?",
  normalized: "Does stress impair memory?",
  startSeconds: 1,
  endSeconds: 2,
  claimType: "causal_mechanistic",
};

function candidate(
  chunkId: string,
  sourceId: string,
  content: string,
  similarity = 0.4,
): EvidenceCandidate {
  return {
    chunkId,
    sourceId,
    chunkKey: chunkId,
    content,
    language: "en",
    locator: "Abstract > Results",
    source: {
      key: `doi:10.0000/${sourceId}`,
      title: `Study ${sourceId}`,
      authors: ["A. Author"],
      journal: "Example Journal",
      publishedAt: "2024-01-01",
      type: "journal_article",
      canonicalUrl: `https://example.org/${sourceId}`,
    },
    similarity,
    retrievalScoreKind: "provider_search_order",
  };
}

describe("evidence reranking and package construction", () => {
  it("ranks direct claim overlap, preserves provenance, and freezes the trace", async () => {
    const candidates = [
      candidate("indirect", "source-a", "Research measured general wellbeing."),
      candidate("direct", "source-b", "Stress impaired memory in the study."),
    ];
    const result = await buildEvidencePackage(claim, {
      ...retrievalMetadata,
      candidates,
      warnings: [],
    });

    expect(result.evidence.map((item) => item.chunkId)).toEqual([
      "direct",
      "indirect",
    ]);
    expect(result.evidence[0]).toMatchObject({
      sourceId: "source-b",
      chunkKey: "direct",
      locator: "Abstract > Results",
      retrievalScore: 0.4,
    });
    expect(result).toMatchObject({
      retrievalVersion: "evidence-retrieval-v1",
      rerankingVersion: "evidence-reranking-v2",
      coverage: "multi_source",
      trace: {
        candidateCount: 2,
        selectedChunkIds: ["direct", "indirect"],
        maximumEvidence: 5,
        maximumChunksPerSource: 2,
      },
    });
  });

  it("deduplicates repeated passages, limits per-source and total evidence, and warns on narrow coverage", async () => {
    const candidates = [
      candidate("a1", "source-a", "Stress impairs memory and attention."),
      candidate("a2", "source-a", "  STRESS impairs memory and attention. "),
      candidate("a3", "source-a", "Stress impaired memory performance."),
      candidate("b1", "source-b", "Stress impaired memory in another sample."),
      candidate(
        "c1",
        "source-c",
        "Stress reduced memory accuracy in a third sample.",
      ),
      candidate(
        "d1",
        "source-d",
        "Stress and memory were studied in another group.",
      ),
      candidate(
        "e1",
        "source-e",
        "Stress changed memory outcomes in a fifth sample.",
      ),
    ];
    const result = await buildEvidencePackage(
      claim,
      {
        ...retrievalMetadata,
        candidates,
        warnings: [],
      },
      {
        async rerank(normalizedClaim, items) {
          return deterministicEvidenceReranker.rerank(normalizedClaim, items);
        },
      },
    );

    expect(result.evidence).toHaveLength(5);
    expect(result.evidence.map((item) => item.chunkId)).not.toContain("a2");
    expect(
      result.evidence.filter((item) => item.sourceId === "source-a"),
    ).toHaveLength(2);
    expect(new Set(result.evidence.map((item) => item.sourceId)).size).toBe(4);
    expect(result.coverage).toBe("multi_source");
  });

  it("reports missing or single-source coverage instead of implying adequacy", async () => {
    const empty = await buildEvidencePackage(claim, {
      ...retrievalMetadata,
      candidates: [],
      warnings: ["no_matching_evidence"],
    });
    const narrow = await buildEvidencePackage(claim, {
      ...retrievalMetadata,
      candidates: [
        candidate("a1", "source-a", "Stress impairs memory."),
        candidate("a2", "source-a", "Stress reduced memory accuracy."),
      ],
      warnings: [],
    });

    expect(empty).toMatchObject({
      coverage: "none",
      evidence: [],
      warnings: ["no_matching_evidence"],
    });
    expect(narrow).toMatchObject({
      coverage: "limited",
      warnings: ["limited_evidence_coverage"],
    });
  });

  it("fails safely when a reranker errors or returns altered, incomplete, or invalid results", async () => {
    const retrieval = {
      ...retrievalMetadata,
      candidates: [
        candidate("candidate-1", "source-a", "Stress impaired memory."),
      ],
      warnings: [],
    };
    const failingReranker = {
      rerank: vi.fn(async () => {
        throw new Error("provider details must not leak");
      }),
    };
    const alteredReranker = {
      async rerank() {
        return [{ chunkId: "unknown-id", relevanceScore: 0.9 }];
      },
    };
    const invalidScoreReranker = {
      async rerank() {
        return [{ chunkId: "candidate-1", relevanceScore: Number.NaN }];
      },
    };

    await expect(
      buildEvidencePackage(claim, retrieval, failingReranker),
    ).rejects.toMatchObject({
      code: "EVIDENCE_RERANKING_FAILED",
      message: "EVIDENCE_RERANKING_FAILED",
    });
    await expect(
      buildEvidencePackage(claim, retrieval, alteredReranker),
    ).rejects.toMatchObject({
      code: "EVIDENCE_RERANKING_RESPONSE_INVALID",
    });
    await expect(
      buildEvidencePackage(claim, retrieval, invalidScoreReranker),
    ).rejects.toBeInstanceOf(EvidenceRerankingError);
  });
});

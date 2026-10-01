import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FactCheckJudgmentError,
  parseJudgmentOutput,
  validateEvidenceBoundJudgment,
} from "../src/server/ai/judgment";
import { verdicts } from "../src/types/fact-check";

const fixtureSchema = z.array(
  z
    .object({
      id: z.string().min(1),
      claim: z.string().min(1),
      chunkIds: z.array(z.uuid()).max(5),
      judgment: z.unknown(),
      expected: z.enum(["accepted", "citation_rejected"]),
      synthetic: z.literal(true),
    })
    .strict(),
);

function packageFor(claim: string, chunkIds: readonly string[]) {
  return {
    claim: {
      original: claim,
      normalized: claim,
      startSeconds: 0,
      endSeconds: 1,
      claimType: "intervention",
    },
    evidence: chunkIds.map((chunkId) => ({
      sourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      chunkId,
      chunkKey: "passage-1",
      text: "Synthetic evidence passage for the contract evaluation.",
      language: "en",
      locator: "Abstract",
      source: {
        key: "doi:10.0000/eval",
        title: "Synthetic evidence source",
        authors: ["Example Author"],
        journal: "Example Journal",
        publishedAt: "2024-01-01",
        type: "journal_article",
        canonicalUrl: "https://example.org/eval",
      },
      retrievalScore: 0.8,
      relevanceScore: 0.9,
    })),
    retrievalVersion: "evidence-retrieval-v1",
    rerankingVersion: "evidence-reranking-v1",
    coverage: chunkIds.length ? "limited" : "none",
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
      candidateCount: chunkIds.length,
      selectedChunkIds: [...chunkIds],
      maximumEvidence: 5,
      maximumChunksPerSource: 2,
    },
  };
}

describe("synthetic fact-check judgment contract eval", () => {
  it("accepts only taxonomy verdicts and package-member citations", () => {
    const fixtureUrl = new URL(
      "./fixtures/fact-check-judgment-v1.json",
      import.meta.url,
    );
    const fixtures = fixtureSchema.parse(
      JSON.parse(readFileSync(fileURLToPath(fixtureUrl), "utf8")),
    );

    for (const fixture of fixtures) {
      if (fixture.expected === "citation_rejected") {
        expect(() =>
          validateEvidenceBoundJudgment(
            packageFor(fixture.claim, fixture.chunkIds),
            parseJudgmentOutput(fixture.judgment),
          ),
        ).toThrowError(
          new FactCheckJudgmentError("FACT_CHECK_CITATION_OUTSIDE_PACKAGE"),
        );
        continue;
      }

      const result = validateEvidenceBoundJudgment(
        packageFor(fixture.claim, fixture.chunkIds),
        parseJudgmentOutput(fixture.judgment),
      );
      expect(verdicts).toContain(result.judgment.verdict);
      expect(
        result.judgment.citations.every((citation) =>
          fixture.chunkIds.includes(citation.chunkId),
        ),
      ).toBe(true);
    }
    expect(fixtures).toHaveLength(3);
  });
});

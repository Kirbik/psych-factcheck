import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { evidenceSeedV0 } from "../src/server/evidence/seed-v0.ts";
import { buildEvidencePackage } from "../src/server/evidence/reranking.ts";
import type { EvidenceCandidate } from "../src/server/evidence/search.ts";

vi.mock("server-only", () => ({}));

interface RetrievalCase {
  readonly id: string;
  readonly query: string;
  readonly relevantChunkKeys: readonly string[];
}

interface RetrievalDataset {
  readonly datasetVersion: string;
  readonly cases: readonly RetrievalCase[];
}

const dataset = JSON.parse(
  await readFile(
    new URL("./fixtures/retrieval-v2.json", import.meta.url),
    "utf8",
  ),
) as RetrievalDataset;

function terms(text: string) {
  return new Set(
    text
      .toLocaleLowerCase("en")
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((term) => term.length > 2) ?? [],
  );
}

function lexicalRank(query: string) {
  const queryTerms = terms(query);
  return evidenceSeedV0.chunks
    .map((chunk, order) => ({
      chunkKey: chunk.chunkKey,
      order,
      overlap: [...terms(chunk.content)].filter((term) => queryTerms.has(term))
        .length,
    }))
    .sort(
      (left, right) => right.overlap - left.overlap || left.order - right.order,
    )
    .map((candidate) => candidate.chunkKey);
}

function precisionAtK(
  ranked: readonly string[],
  relevant: readonly string[],
  k: number,
) {
  const expected = new Set(relevant);
  return (
    ranked.slice(0, k).filter((chunkKey) => expected.has(chunkKey)).length / k
  );
}

const sources = new Map(
  evidenceSeedV0.sources.map((source) => [source.sourceKey, source]),
);
const candidates: readonly EvidenceCandidate[] = evidenceSeedV0.chunks.map(
  (chunk) => {
    const source = sources.get(chunk.sourceKey);
    if (!source) throw new Error(`Missing seed source: ${chunk.sourceKey}`);
    if (
      source.sourceType === "book" ||
      source.sourceType === "textbook" ||
      source.sourceType === "monograph"
    ) {
      throw new Error(
        `Metadata-only source has evidence chunk: ${chunk.sourceKey}`,
      );
    }
    return {
      chunkId: `${chunk.sourceKey}:${chunk.chunkKey}`,
      sourceId: chunk.sourceKey,
      chunkKey: chunk.chunkKey,
      content: chunk.content,
      language: chunk.language,
      locator: chunk.locator,
      source: {
        key: source.sourceKey,
        title: source.title,
        authors: source.authors,
        journal: source.journal,
        publishedAt: source.publishedAt,
        type: source.sourceType,
        canonicalUrl: source.url,
      },
      similarity: 0,
    };
  },
);

describe("evidence package relevance baseline", () => {
  it("preserves or improves provisional lexical P@5 without losing provenance", async () => {
    expect(dataset.datasetVersion).toBe("retrieval-relevance-v2");
    const seedChunkKeys = new Set(
      evidenceSeedV0.chunks.map((chunk) => chunk.chunkKey),
    );
    const baselineScores: number[] = [];
    const packageScores: number[] = [];

    for (const testCase of dataset.cases) {
      expect(
        testCase.relevantChunkKeys.every((chunkKey) =>
          seedChunkKeys.has(chunkKey),
        ),
      ).toBe(true);
      const baseline = lexicalRank(testCase.query);
      const evidencePackage = await buildEvidencePackage(
        {
          original: testCase.query,
          normalized: testCase.query,
          startSeconds: 0,
          endSeconds: 0,
          claimType: "descriptive_prevalence",
        },
        {
          retrievalVersion: "offline-lexical-reference",
          provider: "offline-eval",
          model: "lexical-reference",
          embeddingVersion: "none",
          filters: {
            sourceStatus: "active",
            language: null,
            sourceTypes: null,
            publishedAfter: null,
            publishedBefore: null,
            limit: 10,
          },
          candidates: [...candidates],
          warnings: [],
        },
      );
      const selectedKeys = evidencePackage.evidence.map(
        (item) => item.chunkKey,
      );
      const baselineScore = precisionAtK(
        baseline,
        testCase.relevantChunkKeys,
        5,
      );
      const packageScore = precisionAtK(
        selectedKeys,
        testCase.relevantChunkKeys,
        5,
      );

      expect(evidencePackage.evidence).toHaveLength(5);
      expect(
        evidencePackage.evidence.every((item) =>
          item.source.canonicalUrl.startsWith("https://"),
        ),
      ).toBe(true);
      expect(packageScore).toBeGreaterThanOrEqual(baselineScore);
      baselineScores.push(baselineScore);
      packageScores.push(packageScore);
    }

    const mean = (scores: readonly number[]) =>
      scores.reduce((sum, score) => sum + score, 0) / scores.length;
    console.info(
      `retrieval-relevance-v2: lexical P@5=${mean(baselineScores).toFixed(3)}, package P@5=${mean(packageScores).toFixed(3)}; provisional labels only`,
    );
    expect(mean(packageScores)).toBeGreaterThanOrEqual(mean(baselineScores));
  });
});

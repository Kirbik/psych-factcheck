import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { evidenceSeedV0 } from "../src/server/evidence/seed-v0.ts";

interface RetrievalCase {
  readonly id: string;
  readonly query: string;
  readonly relevantChunkKeys: readonly string[];
}

interface RetrievalDataset {
  readonly datasetVersion: string;
  readonly description: string;
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

describe("retrieval relevance dataset v1", () => {
  it("records a reproducible lexical precision@5 reference over curated evidence chunks", () => {
    expect(dataset.datasetVersion).toBe("retrieval-relevance-v2");
    expect(dataset.cases).toHaveLength(3);
    const seedChunkKeys = new Set(
      evidenceSeedV0.chunks.map((chunk) => chunk.chunkKey),
    );
    const scores = dataset.cases.map((testCase) => {
      expect(testCase.relevantChunkKeys.length).toBeGreaterThan(0);
      expect(
        testCase.relevantChunkKeys.every((chunkKey) =>
          seedChunkKeys.has(chunkKey),
        ),
      ).toBe(true);
      return precisionAtK(
        lexicalRank(testCase.query),
        testCase.relevantChunkKeys,
        5,
      );
    });

    const aggregate =
      scores.reduce((sum, score) => sum + score, 0) / scores.length;
    console.info(
      `retrieval-relevance-v2 lexical baseline: P@5=${aggregate.toFixed(3)} (${scores.map((score) => score.toFixed(3)).join(", ")})`,
    );
    expect(scores).toEqual([0.4, 0.6, 0.2]);
    expect(aggregate).toBeCloseTo(0.4, 3);
    expect(aggregate).toBeGreaterThan(0);
  });
});

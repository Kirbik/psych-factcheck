import { describe, expect, it, vi } from "vitest";
import {
  createOpenAIReportNarrativeProvider,
  ReportNarrativeError,
} from "@/server/ai/report-narrative";
import type { EvidencePackage, FactCheckJudgment } from "@/server/ai/providers";

const claimId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const chunkId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const evidencePackage: EvidencePackage = {
  claim: {
    original: "Недосып влияет на память.",
    normalized: "Недосып влияет на память.",
    startSeconds: 0,
    endSeconds: 2,
    claimType: "causal_mechanistic",
  },
  evidence: [
    {
      sourceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      chunkId,
      chunkKey: "test-passage",
      text: "Контролируемый фрагмент evidence package.",
      language: "ru",
      locator: "paragraph 1",
      source: {
        key: "doi:10.0000/test",
        title: "Test study",
        authors: ["Researcher"],
        journal: "Journal",
        publishedAt: "2025",
        type: "journal_article",
        canonicalUrl: "https://example.org/study",
      },
      retrievalScore: 0.8,
      relevanceScore: 0.9,
    },
  ],
  retrievalVersion: "test-retrieval-v1",
  rerankingVersion: "test-reranking-v1",
  coverage: "limited",
  warnings: [],
  trace: {
    retrieval: {
      provider: "test",
      model: "test-embedding",
      embeddingVersion: "test-embedding-v1",
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

const judgment: FactCheckJudgment = {
  verdict: "SUPPORTED",
  confidence: 0.7,
  explanation: "Фрагмент ограниченно поддерживает формулировку.",
  limitations: ["Один источник."],
  citations: [{ chunkId, relation: "supports", rationale: "Тот же исход." }],
};

function responseWith(value: unknown) {
  return new Response(
    JSON.stringify({
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(value) }] },
      ],
    }),
    { status: 200 },
  );
}

describe("report narrative provider", () => {
  it("returns comments and overall opinion for exactly the supplied claims", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responseWith({
        claims: [{ claimId, commentary: "Комментарий о границах результата." }],
        overallConclusion: "Вывод только по переданному источнику.",
        subjectiveOpinion: "Субъективно формулировка выглядит осторожной.",
      }),
    );
    const provider = createOpenAIReportNarrativeProvider("test-key", fetcher);
    await expect(
      provider.generate([{ claimId, evidencePackage, judgment }]),
    ).resolves.toMatchObject({
      claims: [{ claimId, commentary: "Комментарий о границах результата." }],
      overallConclusion: expect.any(String),
      subjectiveOpinion: expect.any(String),
    });
    const requestBody = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(requestBody).toContain(claimId);
  });

  it("rejects comments for claims outside the requested set", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responseWith({
        claims: [
          {
            claimId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            commentary: "неподтверждённый комментарий",
          },
        ],
        overallConclusion: "Вывод.",
        subjectiveOpinion: "Мнение.",
      }),
    );
    const provider = createOpenAIReportNarrativeProvider("test-key", fetcher);
    await expect(
      provider.generate([{ claimId, evidencePackage, judgment }]),
    ).rejects.toMatchObject({
      code: "REPORT_NARRATIVE_CLAIMS_MISMATCH",
    } satisfies Partial<ReportNarrativeError>);
  });

  it("supports a completed analysis with no claims", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responseWith({
        claims: [],
        overallConclusion: "Проверяемых утверждений нет.",
        subjectiveOpinion: "Доказательную оценку ролика дать нельзя.",
      }),
    );
    const provider = createOpenAIReportNarrativeProvider("test-key", fetcher);
    await expect(provider.generate([])).resolves.toMatchObject({ claims: [] });
  });

  it("classifies rate limits as retryable without making a live request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 429 }));
    const provider = createOpenAIReportNarrativeProvider("test-key", fetcher);
    await expect(
      provider.generate([{ claimId, evidencePackage, judgment }]),
    ).rejects.toMatchObject({
      code: "OPENAI_UNAVAILABLE",
      retryable: true,
    } satisfies Partial<ReportNarrativeError>);
  });

  it("classifies a timed-out transport as retryable", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("timeout"));
    const provider = createOpenAIReportNarrativeProvider("test-key", fetcher);
    await expect(
      provider.generate([{ claimId, evidencePackage, judgment }]),
    ).rejects.toMatchObject({
      code: "OPENAI_UNAVAILABLE",
      retryable: true,
    } satisfies Partial<ReportNarrativeError>);
  });
});

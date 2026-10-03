import { describe, expect, it, vi } from "vitest";
import {
  createOpenAIReportNarrativeProvider,
  persistedReportNarrativeSchema,
  ReportNarrativeError,
} from "@/server/ai/report-narrative";
import {
  HISTORICAL_PERSPECTIVES,
  HISTORICAL_PERSPECTIVES_VERSION,
} from "@/server/ai/historical-perspectives";
import type { EvidencePackage, FactCheckJudgment } from "@/server/ai/providers";
import { createReportNarrativeService } from "@/server/ai/report-narrative-service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));

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
        historicalConnections: [],
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
        historicalConnections: [],
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
        historicalConnections: [],
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

  it("adds an attributed editorial paraphrase and preserves its primary-source metadata", async () => {
    const relatedPackage = {
      ...evidencePackage,
      claim: {
        ...evidencePackage.claim,
        normalized: "В отношениях повторяются болезненные сценарии.",
      },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responseWith({
        claims: [{ claimId, commentary: "Комментарий." }],
        overallConclusion: "Доказательный вывод ограничен.",
        subjectiveOpinion:
          "Мне близка мысль о внимании к повторяющимся сценариям.",
        historicalConnections: [{ referenceId: "freud-repetition", claimId }],
      }),
    );
    const result = await createOpenAIReportNarrativeProvider(
      "test-key",
      fetcher,
    ).generate([{ claimId, evidencePackage: relatedPackage, judgment }]);
    expect(result.subjectiveOpinion).toContain(
      "Зигмунд Фрейд в книге «По ту сторону принципа удовольствия» (1920, глава III)",
    );
    expect(result.subjectiveOpinion).toContain(
      "пересказ теорий, не научное подтверждение",
    );
    expect(result.overallConclusion).toBe("Доказательный вывод ограничен.");
    expect(result.historicalReferences).toEqual([
      expect.objectContaining({
        id: "freud-repetition",
        claimId,
        catalogVersion: HISTORICAL_PERSPECTIVES_VERSION,
        url: HISTORICAL_PERSPECTIVES[0].url,
        paraphrase: HISTORICAL_PERSPECTIVES[0].paraphrase,
      }),
    ]);
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      input: string;
    };
    const input = JSON.parse(request.input) as {
      historicalPerspectives: unknown[];
      claims: { evidencePackage: { evidence: unknown[] } }[];
    };
    expect(input.historicalPerspectives).toHaveLength(4);
    expect(input.claims[0]?.evidencePackage.evidence).toHaveLength(1);
  });

  it.each([
    [{ referenceId: "invented-author", claimId }],
    [
      {
        referenceId: "freud-repetition",
        claimId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
    ],
    [
      { referenceId: "freud-repetition", claimId },
      { referenceId: "freud-repetition", claimId },
    ],
    [
      {
        referenceId: "freud-repetition",
        claimId,
        paraphrase: "Фрейд доказал всё.",
      },
    ],
  ])(
    "rejects unknown, unbound, duplicate or model-authored historical attribution: %j",
    async (...connections) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        responseWith({
          claims: [{ claimId, commentary: "Комментарий." }],
          overallConclusion: "Вывод.",
          subjectiveOpinion: "Мнение.",
          historicalConnections: connections,
        }),
      );
      await expect(
        createOpenAIReportNarrativeProvider("test-key", fetcher).generate([
          { claimId, evidencePackage, judgment },
        ]),
      ).rejects.toBeInstanceOf(ReportNarrativeError);
    },
  );

  it("does not accept historical parallels when no claims were supplied", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responseWith({
        claims: [],
        overallConclusion: "Нет утверждений.",
        subjectiveOpinion: "Нет материала.",
        historicalConnections: [{ referenceId: "adler-community", claimId }],
      }),
    );
    await expect(
      createOpenAIReportNarrativeProvider("test-key", fetcher).generate([]),
    ).rejects.toMatchObject({
      code: "REPORT_NARRATIVE_HISTORY_MISMATCH",
    });
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      input: string;
    };
    const input = JSON.parse(request.input) as {
      historicalPerspectives: unknown[];
    };
    expect(input.historicalPerspectives).toEqual([]);
  });

  it("fits two complete historical examples into the persisted text bound without truncation", async () => {
    for (const first of HISTORICAL_PERSPECTIVES) {
      for (const second of HISTORICAL_PERSPECTIVES.filter(
        ({ id }) => id !== first.id,
      )) {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
          responseWith({
            claims: [{ claimId, commentary: "Комментарий." }],
            overallConclusion: "Вывод.",
            subjectiveOpinion: "М".repeat(800),
            historicalConnections: [
              { referenceId: first.id, claimId },
              { referenceId: second.id, claimId },
            ],
          }),
        );
        const result = await createOpenAIReportNarrativeProvider(
          "test-key",
          fetcher,
        ).generate([{ claimId, evidencePackage, judgment }]);
        expect(result.subjectiveOpinion.length).toBeLessThanOrEqual(1500);
        expect(result.subjectiveOpinion).toContain(first.paraphrase);
        expect(result.subjectiveOpinion).toContain(second.paraphrase);
      }
    }
  });

  it("continues reading historical reports without the optional references", () => {
    expect(
      persistedReportNarrativeSchema.safeParse({
        claims: [],
        overallConclusion: "Вывод.",
        subjectiveOpinion: "Прежнее мнение.",
      }).success,
    ).toBe(true);
  });

  it("persists resolved book attribution alongside the opinion through the fenced RPC", async () => {
    const packageId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const factCheckId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const rows: Record<string, unknown> = {
      analysis_report_narratives: null,
      evidence_packages: [
        { id: packageId, claim_id: claimId, payload: evidencePackage },
      ],
      fact_checks: [
        {
          ...judgment,
          id: factCheckId,
          claim_id: claimId,
          evidence_package_id: packageId,
        },
      ],
      fact_check_evidence: [
        {
          fact_check_id: factCheckId,
          evidence_chunk_id: chunkId,
          relation: "supports",
          rationale: "Тот же исход.",
        },
      ],
    };
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: "saved-narrative-id", error: null });
    // Test only the repository methods this service uses; the SDK is not invoked.
    const client = {
      from: vi.fn((table: string) => {
        const response = Promise.resolve({ data: rows[table], error: null });
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockReturnValue(response),
          then: response.then.bind(response),
        };
      }),
      rpc,
    } as unknown as SupabaseClient<Database>;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responseWith({
        claims: [{ claimId, commentary: "Комментарий." }],
        overallConclusion: "Вывод.",
        subjectiveOpinion: "Мне кажется, формулировка требует осторожности.",
        historicalConnections: [{ referenceId: "adler-compensation", claimId }],
      }),
    );
    const service = createReportNarrativeService(
      client,
      createOpenAIReportNarrativeProvider("test-key", fetcher),
    );
    const run = {
      targets: [{ claimId, evidencePackageId: packageId }],
      jobId: claimId,
      generation: 3,
      runId: "current-run",
    };
    await expect(service.generateAndSave(run)).resolves.toBe(
      "saved-narrative-id",
    );
    expect(rpc).toHaveBeenCalledWith(
      "save_analysis_report_narrative_for_run",
      expect.objectContaining({
        p_generation: 3,
        p_run_id: "current-run",
        p_payload: expect.objectContaining({
          historicalReferences: [
            expect.objectContaining({
              id: "adler-compensation",
              claimId,
              url: HISTORICAL_PERSPECTIVES[2].url,
            }),
          ],
          subjectiveOpinion: expect.stringContaining(
            "Альфред Адлер в книге «Познание человека»",
          ),
        }),
      }),
    );
    rows.analysis_report_narratives = { id: "saved-narrative-id" };
    await expect(service.generateAndSave(run)).resolves.toBe(
      "saved-narrative-id",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

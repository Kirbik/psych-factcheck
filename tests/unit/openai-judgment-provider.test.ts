import { describe, expect, it, vi } from "vitest";
import {
  JudgmentProviderError,
  createOpenAIJudgmentProvider,
} from "@/server/ai/openai-judgment-provider";

const chunkId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const packageFixture = {
  claim: {
    original: "Недосып влияет на память.",
    normalized: "Недосып влияет на память.",
    startSeconds: 0,
    endSeconds: 2,
    claimType: "causal_mechanistic",
  },
  evidence: [
    {
      sourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      chunkId,
      chunkKey: "abstract-1",
      text: "Синтетический фрагмент о сне и памяти.",
      language: "ru",
      locator: "abstract",
      source: {
        key: "doi:10.0000/example",
        title: "Synthetic study",
        authors: ["Example Author"],
        journal: "Example Journal",
        publishedAt: "2024",
        type: "journal_article",
        canonicalUrl: "https://example.org/study",
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
} as const;

const validOutput = {
  claim_type: "causal",
  model_verdict: "plausible",
  verdict: "supported",
  evidence_strength: "moderate",
  assessment_confidence: "moderate",
  short_conclusion: "Данные поддерживают ограниченную формулировку.",
  reasoning: "В приведенном фрагменте сообщается о таком же результате.",
  caveats: ["В пакете только один источник."],
  needed_for_assessment: "Нужны независимые репликации.",
  citations: [
    {
      chunk_id: chunkId,
      relation: "supports",
      rationale: "The passage reports the same outcome in the stated context.",
    },
  ],
};

function apiResponse(output: unknown) {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(output) }],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("OpenAI judgment provider", () => {
  it("sends the package as untrusted input with strict structured output", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apiResponse(validOutput));
    const provider = createOpenAIJudgmentProvider("secret", fetcher);

    await expect(provider.judge(packageFixture)).resolves.toMatchObject({
      verdict: "SUPPORTED",
      confidence: null,
      assessment: { researchVerdict: "supported", confidence: "moderate" },
      citations: [{ chunkId, relation: "supports" }],
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      model: "gpt-4o-mini",
      store: false,
      text: {
        format: {
          type: "json_schema",
          strict: true,
          name: "fact_check_judgment",
        },
      },
    });
    expect(request.input).toContain("Синтетический фрагмент");
    expect(request.instructions).toContain(
      "не выдавай их за проверенную научную литературу",
    );
    expect(request.instructions).toContain("научный поиск отключён");
    expect(request.text.format.schema.required).toContain("model_verdict");
    expect(
      request.text.format.schema.properties.citations.items.properties.chunk_id,
    ).toEqual({ type: "string", enum: [chunkId] });
    expect(provider).toMatchObject({
      provider: "openai",
      judgmentVersion: "fact-check-judgment-v8",
      instructionsVersion: "psychology-evidence-check-v4",
      schemaVersion: "fact-check-judgment-schema-v7",
    });
  });

  it("prevents citations when the package contains no evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      apiResponse({
        ...validOutput,
        verdict: "unknown",
        citations: [],
      }),
    );
    const emptyPackage = {
      ...packageFixture,
      evidence: [],
      coverage: "none",
      trace: {
        ...packageFixture.trace,
        candidateCount: 0,
        selectedChunkIds: [],
      },
    } as const;

    await expect(
      createOpenAIJudgmentProvider("secret", fetcher).judge(emptyPackage),
    ).resolves.toMatchObject({
      verdict: "INSUFFICIENT_EVIDENCE",
      citations: [],
    });
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(request.text.format.schema.properties.citations.maxItems).toBe(0);
  });

  it("keeps the scientific verdict unknown but returns a separate prompt-only model assessment", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      apiResponse({
        ...validOutput,
        model_verdict: "overgeneralized",
        verdict: "unknown",
        evidence_strength: "insufficient",
        assessment_confidence: "low",
        citations: [],
      }),
    );
    const emptyPackage = {
      ...packageFixture,
      evidence: [],
      retrievalVersion: "psychology-skill-no-search-v1",
      rerankingVersion: "no-reranking-v1",
      coverage: "none",
      warnings: ["scientific_search_not_performed"],
      trace: {
        ...packageFixture.trace,
        retrieval: {
          provider: "none",
          model: "none",
          filters: packageFixture.trace.retrieval.filters,
        },
        candidateCount: 0,
        selectedChunkIds: [],
      },
    } as const;

    await expect(
      createOpenAIJudgmentProvider("secret", fetcher).judge(emptyPackage),
    ).resolves.toMatchObject({
      verdict: "INSUFFICIENT_EVIDENCE",
      assessment: {
        researchVerdict: "unknown",
        modelVerdict: "overgeneralized",
        evidenceStrength: "insufficient",
      },
      citations: [],
    });
  });

  it("normalizes unsupported model verdicts before returning a no-search judgment", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      apiResponse({
        ...validOutput,
        model_verdict: "questionable",
        verdict: "false",
        evidence_strength: "high",
        assessment_confidence: "high",
        citations: [],
      }),
    );
    const emptyPackage = {
      ...packageFixture,
      evidence: [],
      retrievalVersion: "psychology-skill-no-search-v1",
      rerankingVersion: "no-reranking-v1",
      coverage: "none",
      warnings: ["scientific_search_not_performed"],
      trace: {
        ...packageFixture.trace,
        retrieval: {
          ...packageFixture.trace.retrieval,
          provider: "none",
          model: "none",
          filters: {
            ...packageFixture.trace.retrieval.filters,
            sourceStatus: "not_used",
          },
        },
        candidateCount: 0,
        selectedChunkIds: [],
      },
    } as const;

    await expect(
      createOpenAIJudgmentProvider("secret", fetcher).judge(emptyPackage),
    ).resolves.toMatchObject({
      verdict: "INSUFFICIENT_EVIDENCE",
      assessment: {
        researchVerdict: "unknown",
        modelVerdict: "questionable",
        evidenceStrength: "insufficient",
        confidence: "low",
      },
      citations: [],
    });
  });

  it("rejects a model citation that is not in the supplied package", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      apiResponse({
        ...validOutput,
        citations: [
          {
            ...validOutput.citations[0],
            chunk_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          },
        ],
      }),
    );
    const provider = createOpenAIJudgmentProvider("secret", fetcher);

    await expect(provider.judge(packageFixture)).rejects.toMatchObject({
      code: "FACT_CHECK_CITATION_OUTSIDE_PACKAGE",
      retryable: false,
    });
  });

  it("rejects a preliminary model verdict outside the versioned taxonomy", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        apiResponse({ ...validOutput, model_verdict: "certainly_true" }),
      );

    await expect(
      createOpenAIJudgmentProvider("secret", fetcher).judge(packageFixture),
    ).rejects.toMatchObject({
      code: "FACT_CHECK_JUDGMENT_INVALID",
      retryable: false,
    });
  });

  it("rejects malformed JSON output and identifies missing configuration", async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "{" }],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(
      createOpenAIJudgmentProvider("secret", malformed).judge(packageFixture),
    ).rejects.toMatchObject({ code: "FACT_CHECK_OUTPUT_NOT_JSON" });
    await expect(
      createOpenAIJudgmentProvider(undefined, malformed).judge(packageFixture),
    ).rejects.toBeInstanceOf(JudgmentProviderError);
  });
});

import { describe, expect, it } from "vitest";
import {
  FactCheckJudgmentError,
  validateEvidenceBoundJudgment,
} from "@/server/ai/judgment";

const chunkId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function evidencePackage(evidenceIds: readonly string[] = [chunkId]) {
  return {
    claim: {
      original: "Недосып влияет на память.",
      normalized: "Недосып влияет на память.",
      startSeconds: 0,
      endSeconds: 2,
      claimType: "causal_mechanistic",
    },
    evidence: evidenceIds.map((id) => ({
      sourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      chunkId: id,
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
    })),
    retrievalVersion: "evidence-retrieval-v1",
    rerankingVersion: "evidence-reranking-v1",
    coverage:
      evidenceIds.length > 1
        ? "multi_source"
        : evidenceIds.length
          ? "limited"
          : "none",
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
      candidateCount: evidenceIds.length,
      selectedChunkIds: [...evidenceIds],
      maximumEvidence: 5,
      maximumChunksPerSource: 2,
    },
  };
}

const validJudgment = {
  verdict: "SUPPORTED",
  confidence: 0.72,
  explanation: "The package passage supports the bounded claim.",
  limitations: ["The package contains one source."],
  citations: [
    {
      chunkId,
      relation: "supports",
      rationale: "The passage reports the same outcome in the stated context.",
    },
  ],
};

describe("evidence-bound fact-check judgment", () => {
  it("accepts only a taxonomy verdict with unique citations from the package", () => {
    const result = validateEvidenceBoundJudgment(
      evidencePackage(),
      validJudgment,
    );
    expect(result.judgment).toMatchObject({
      verdict: "SUPPORTED",
      confidence: 0.72,
      citations: [{ chunkId, relation: "supports" }],
    });
  });

  it("rejects citations to chunks absent from the package", () => {
    expect(() =>
      validateEvidenceBoundJudgment(evidencePackage(), {
        ...validJudgment,
        citations: [
          {
            ...validJudgment.citations[0],
            chunkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          },
        ],
      }),
    ).toThrowError(
      new FactCheckJudgmentError("FACT_CHECK_CITATION_OUTSIDE_PACKAGE"),
    );
  });

  it("rejects unsupported verdicts and evidence-based verdicts without citations", () => {
    expect(() =>
      validateEvidenceBoundJudgment(evidencePackage(), {
        ...validJudgment,
        verdict: "PLAUSIBLE",
      }),
    ).toThrowError("FACT_CHECK_JUDGMENT_INVALID");
    expect(() =>
      validateEvidenceBoundJudgment(evidencePackage(), {
        ...validJudgment,
        citations: [],
      }),
    ).toThrowError("FACT_CHECK_EVIDENCE_REQUIRED");
  });

  it("does not permit evidence-based verdicts when the package is empty", () => {
    const emptyPackage = evidencePackage([]);
    expect(() =>
      validateEvidenceBoundJudgment(emptyPackage, {
        ...validJudgment,
        citations: [],
      }),
    ).toThrowError("FACT_CHECK_EVIDENCE_REQUIRED");
    expect(
      validateEvidenceBoundJudgment(emptyPackage, {
        verdict: "INSUFFICIENT_EVIDENCE",
        confidence: 0.95,
        explanation: "The package contains no relevant passages.",
        limitations: ["No evidence was retrieved."],
        citations: [],
      }).judgment.verdict,
    ).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("keeps metadata-only publications outside the evidence basis", () => {
    const packageWithReferences = {
      ...evidencePackage([]),
      references: [
        {
          id: "10.1234/metadata",
          title: "Metadata-only paper",
          authors: ["Example Author"],
          year: "2024",
          doi: "10.1234/metadata",
          url: "https://doi.org/10.1234%2Fmetadata",
          dataProvider: "crossref",
          providerVersion: "crossref-v1",
          availability: "metadata_only",
          licenseUrl: null,
        },
      ],
    };
    expect(
      validateEvidenceBoundJudgment(packageWithReferences, {
        verdict: "INSUFFICIENT_EVIDENCE",
        confidence: 0.9,
        explanation: "Only publication metadata was found.",
        limitations: ["No licensed evidence text was available."],
        citations: [],
      }).evidencePackage.references,
    ).toHaveLength(1);
    expect(() =>
      validateEvidenceBoundJudgment(packageWithReferences, {
        ...validJudgment,
        citations: [],
      }),
    ).toThrowError("FACT_CHECK_EVIDENCE_REQUIRED");
  });

  it("rejects a full-text citation with unknown or non-approved attribution", () => {
    const pkg = evidencePackage();
    const invalidAttribution = {
      ...pkg,
      evidence: [
        {
          ...pkg.evidence[0],
          attribution: {
            dataProvider: "europe-pmc",
            providerVersion: "europe-pmc-v1",
            externalId: "PMC12345",
            availability: "open_access_full_text",
            licenseCode: "UNKNOWN",
            licenseUrl: "https://example.org/license",
          },
        },
      ],
    };
    expect(() =>
      validateEvidenceBoundJudgment(invalidAttribution, validJudgment),
    ).toThrowError("FACT_CHECK_EVIDENCE_PACKAGE_INVALID");
  });

  it("rejects package text outside the bounded evidence contract", () => {
    expect(() =>
      validateEvidenceBoundJudgment(
        { ...evidencePackage(), unexpected: "ignored by no one" },
        validJudgment,
      ),
    ).toThrowError("FACT_CHECK_EVIDENCE_PACKAGE_INVALID");
  });
});

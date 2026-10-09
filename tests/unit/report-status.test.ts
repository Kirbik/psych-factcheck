import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { reportRepository } from "@/server/db/report-repository";
import { FACT_CHECK_JUDGMENT_VERSION } from "@/server/ai/judgment";
import type { Verdict } from "@/types/fact-check";

vi.mock("server-only", () => ({}));

function completedReport(
  verdict: Verdict,
  cited = true,
  brokenSource = false,
  foreignPackage = false,
  overrides: Record<string, unknown> = {},
) {
  const rows: Record<string, unknown> = {
    content_items: { id: "content", original_file_name: "video.mp4" },
    analysis_jobs: {
      id: "job",
      generation: 1,
      status: "completed",
      stage: "complete",
      completed_at: "2026-10-03T12:00:00Z",
      error_code: null,
    },
    analysis_report_narratives: null,
    transcripts: { id: "transcript" },
    claim_extractions: { id: "extraction" },
    claims: [
      {
        id: "claim",
        original_text: "Утверждение ролика.",
        normalized_text: "Утверждение ролика.",
        start_seconds: 0,
        end_seconds: 5,
        ordinal: 0,
      },
    ],
    // Bibliographic references and uncited candidates must not count as citations.
    evidence_packages: [
      {
        id: "package",
        claim_id: "claim",
        payload: {
          references: [
            { dataProvider: "crossref", availability: "metadata_only" },
          ],
          evidence: [{ chunkId: "chunk" }],
        },
      },
    ],
    fact_checks: [
      {
        id: "check",
        claim_id: "claim",
        evidence_package_id: "package",
        judgment_version: FACT_CHECK_JUDGMENT_VERSION,
        verdict,
        confidence: 0.3,
        explanation: "Источники дают ограниченные данные для решения.",
      },
    ],
    fact_check_evidence: cited
      ? [
          {
            fact_check_id: "check",
            evidence_chunk_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            ordinal: 0,
          },
        ]
      : [],

    evidence_package_items: brokenSource
      ? []
      : [
          {
            evidence_package_id: foreignPackage ? "other-package" : "package",
            evidence_chunk_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            snapshot: {
              chunkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              sourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              chunkKey: "licensed-excerpt",
              text: "A real received fixture passage",
              language: "en",
              locator: "paragraph",
              retrievalScore: 0.9,
              relevanceScore: 0.8,
              source: {
                key: "doi:10.0000/fixture",
                title: "Исследование",
                authors: ["Исследователь"],
                journal: "Журнал",
                publisher: "Издатель",
                publishedAt: "2020",
                type: "journal_article",
                canonicalUrl: "https://example.org/study",
              },
            },
          },
        ],
    report_localizations: [],
  };
  Object.assign(rows, overrides);
  // Only this repository's fluent read methods are mocked; no SDK or API calls.
  const client = {
    from: vi.fn((table: string) => {
      if (table === "sources" || table === "evidence_chunks")
        throw new Error("Retired RAG table accessed");
      const response = Promise.resolve({ data: rows[table], error: null });
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockReturnValue(response),
        then: response.then.bind(response),
      };
    }),
  } as unknown as SupabaseClient<Database>;
  return reportRepository(client).getOwnedReport("content", "owner");
}

describe("report status evidence criteria", () => {
  it("keeps a historical narrative bound to its exact saved judgment when newer packages exist", async () => {
    const claimId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const oldId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const newId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const check = (
      id: string,
      version: string,
      verdict: Verdict,
      pkg: string,
    ) => ({
      id,
      claim_id: claimId,
      evidence_package_id: pkg,
      judgment_version: version,
      verdict,
      confidence: 0.3,
      explanation: "Источники дают ограниченные данные.",
    });
    const result = await completedReport("SUPPORTED", true, false, false, {
      claims: [
        {
          id: claimId,
          original_text: "Утверждение ролика.",
          normalized_text: "Утверждение ролика.",
          start_seconds: 0,
          end_seconds: 5,
          ordinal: 0,
        },
      ],
      evidence_packages: [
        { id: "package", claim_id: claimId },
        { id: "new-package", claim_id: claimId },
      ],
      fact_checks: [
        check(
          newId,
          FACT_CHECK_JUDGMENT_VERSION,
          "CONTRADICTED",
          "new-package",
        ),
        check(oldId, "fact-check-judgment-v1", "SUPPORTED", "package"),
      ],
      fact_check_evidence: [
        {
          fact_check_id: oldId,
          evidence_chunk_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          ordinal: 0,
        },
      ],
      analysis_report_narratives: {
        payload: {
          claims: [
            {
              claimId,
              factCheckId: oldId,
              commentary: "Сохранённый комментарий.",
            },
          ],
          overallConclusion: "Сохранённый общий вывод.",
          subjectiveOpinion: "Сохранённое мнение.",
        },
      },
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready")
      throw new Error("Historical report must stay readable");
    expect(result.report.claims[0]).toMatchObject({
      verdict: "SUPPORTED",
      modelCommentary: "Сохранённый комментарий.",
    });
    expect(result.report.claims[0].sources).toHaveLength(1);
  });

  it("rejects a citation whose received snapshot belongs to another package", async () => {
    expect((await completedReport("SUPPORTED", true, false, true)).kind).toBe(
      "unavailable",
    );
  });
  it("shows insufficient but cited evidence as disputed while preserving the saved verdict", async () => {
    const result = await completedReport("INSUFFICIENT_EVIDENCE");
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Report must be ready");
    expect(result.report.claims[0]).toMatchObject({
      verdict: "INSUFFICIENT_EVIDENCE",
      status: "disputed",
      sources: [
        expect.objectContaining({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
      ],
    });
  });

  it("keeps missing usable evidence in not-found even when metadata or uncited candidates exist", async () => {
    const result = await completedReport("INSUFFICIENT_EVIDENCE", false);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Report must be ready");
    expect(result.report.claims[0]).toMatchObject({
      verdict: "INSUFFICIENT_EVIDENCE",
      status: "not-found",
      sources: [],
    });
  });

  it.each([
    ["CONTRADICTED", "contradicted"],
    ["SUPPORTED", "supported"],
    ["MOSTLY_SUPPORTED", "disputed"],
    ["OVERSIMPLIFIED", "disputed"],
    ["UNVERIFIABLE", "not-found"],
  ] as const)("preserves the mapping for %s", async (verdict, status) => {
    const result = await completedReport(verdict);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Report must be ready");
    expect(result.report.claims[0]).toMatchObject({ verdict, status });
  });

  it("does not assign a broader badge from a broken source link", async () => {
    expect(
      (await completedReport("INSUFFICIENT_EVIDENCE", true, true)).kind,
    ).toBe("unavailable");
  });
});

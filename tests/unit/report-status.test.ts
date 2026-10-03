import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { reportRepository } from "@/server/db/report-repository";
import { FACT_CHECK_JUDGMENT_VERSION } from "@/server/ai/judgment";
import type { Verdict } from "@/types/fact-check";

vi.mock("server-only", () => ({}));

function completedReport(verdict: Verdict, cited = true, brokenSource = false) {
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
      ? [{ fact_check_id: "check", evidence_chunk_id: "chunk", ordinal: 0 }]
      : [],
    evidence_chunks: [{ id: "chunk", source_id: "source" }],
    sources: brokenSource
      ? []
      : [
          {
            id: "source",
            title: "Исследование",
            authors: ["Исследователь"],
            journal: "Журнал",
            publisher: "Издатель",
            published_at: "2020",
            source_type: "journal_article",
            canonical_url: "https://example.org/study",
          },
        ],
    report_localizations: [],
  };
  // Only this repository's fluent read methods are mocked; no SDK or API calls.
  const client = {
    from: vi.fn((table: string) => {
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
  it("shows insufficient but cited evidence as disputed while preserving the saved verdict", async () => {
    const result = await completedReport("INSUFFICIENT_EVIDENCE");
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Report must be ready");
    expect(result.report.claims[0]).toMatchObject({
      verdict: "INSUFFICIENT_EVIDENCE",
      status: "disputed",
      sources: [expect.objectContaining({ id: "source" })],
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

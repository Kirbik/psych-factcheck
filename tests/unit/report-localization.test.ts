import { describe, expect, it, vi } from "vitest";
import {
  ReportLocalizationError,
  translateReportTextToRussian,
} from "@/server/ai/report-localization";

const input = [
  {
    factCheckId: "711373a3-f4ba-4bec-9876-b1137e6205ca",
    normalizedText: "Caffeine may increase anxiety in some people.",
    explanation: "The evidence suggests the effect depends on dose.",
  },
] as const;

function responseFor(translations: unknown) {
  return new Response(
    JSON.stringify({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({ translations }),
            },
          ],
        },
      ],
    }),
    { status: 200 },
  );
}

describe("translateReportTextToRussian", () => {
  it("returns validated Russian text keyed to the original fact check", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responseFor([
        {
          fact_check_id: input[0].factCheckId,
          normalized_text:
            "Кофеин может усиливать тревожность у некоторых людей.",
          explanation: "Данные показывают, что эффект зависит от дозы.",
        },
      ]),
    );

    await expect(
      translateReportTextToRussian("test-key", input, fetcher),
    ).resolves.toEqual([
      {
        fact_check_id: input[0].factCheckId,
        normalized_text:
          "Кофеин может усиливать тревожность у некоторых людей.",
        explanation: "Данные показывают, что эффект зависит от дозы.",
      },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects English or mismatched model output", async () => {
    const englishFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responseFor([
        {
          fact_check_id: input[0].factCheckId,
          normalized_text: "Caffeine may increase anxiety.",
          explanation: "The evidence depends on dose.",
        },
      ]),
    );
    const mismatchedFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responseFor([
        {
          fact_check_id: "811373a3-f4ba-4bec-9876-b1137e6205ca",
          normalized_text: "Кофеин может усиливать тревожность.",
          explanation: "Данные зависят от дозы.",
        },
      ]),
    );

    await expect(
      translateReportTextToRussian("test-key", input, englishFetcher),
    ).rejects.toBeInstanceOf(ReportLocalizationError);
    await expect(
      translateReportTextToRussian("test-key", input, mismatchedFetcher),
    ).rejects.toBeInstanceOf(ReportLocalizationError);
  });
});

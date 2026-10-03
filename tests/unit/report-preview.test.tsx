import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportPreview } from "@/components/preview/report-preview";
import type {
  ReportLoadResult,
  ReportSource,
} from "@/features/report/report-contract";

vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "" }),
  Lora: () => ({ variable: "" }),
}));

const sharedSource: ReportSource = {
  id: "source-1",
  title: "Факторы, связанные с тревожностью",
  authors: ["Иванова И."],
  journal: "Психологические исследования",
  publisher: "Научное издательство",
  publishedAt: "2023-01-01",
  sourceType: "systematic_review",
  url: "https://example.org/review",
};

const reportResult: ReportLoadResult = {
  kind: "ready",
  report: {
    contentItemId: "content-1",
    fileName: "video.mp4",
    checkedAt: "2026-10-01T17:11:21.000Z",
    claims: [
      {
        id: "claim-1",
        title: "Кофеин всегда усиливает тревожность",
        originalText: "Кофе всегда усиливает тревожность.",
        normalizedText: "Употребление кофеина всегда усиливает тревожность.",
        startSeconds: 34,
        endSeconds: 42,
        verdict: "CONTRADICTED",
        status: "contradicted",
        confidence: 0.81,
        explanation: "Эффект зависит от дозы и индивидуальных особенностей.",
        modelCommentary:
          "Абсолютная формулировка требует осторожного прочтения.",
        sources: [sharedSource],
      },
      {
        id: "claim-2",
        title: "Кофеин улучшает внимание",
        originalText: "Кофеин может улучшить внимание.",
        normalizedText: "Кофеин может улучшать внимание.",
        startSeconds: 58,
        endSeconds: 64,
        verdict: "SUPPORTED",
        status: "supported",
        confidence: 0.71,
        explanation: "Данные подтверждают кратковременный эффект.",
        modelCommentary:
          "В этом утверждении важно не переносить кратковременный эффект на все ситуации.",
        sources: [sharedSource],
      },
    ],
    narrative: {
      overallConclusion:
        "В ролике есть как подтвержденные, так и противоречащие данным утверждения.",
      subjectiveOpinion:
        "Моё субъективное впечатление: формулировки ролика местами звучат категоричнее, чем позволяют данные.",
    },
  },
};

describe("ReportPreview", () => {
  afterEach(() => cleanup());

  it("renders the completed report data and counts each used source once", () => {
    render(<ReportPreview result={reportResult} />);

    expect(
      screen.getByRole("heading", { name: "Отчет: video.mp4" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Источник видео").parentElement).toHaveTextContent(
      "Видеофайл",
    );
    expect(
      screen.getByText("Утверждения", { selector: "b" }).parentElement,
    ).toHaveTextContent("2");
    expect(
      screen.getByText("Источники", { selector: "b" }).parentElement,
    ).toHaveTextContent("1");
    expect(
      screen.getByRole("img", {
        name: /Расходится с данными — 1.*Данные подтверждены — 1/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Проверка завершена 1 октября 2026, 20:11"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Общий вывод" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/местами звучат категоричнее/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("tab", { name: /Кофеин всегда усиливает тревожность/ }),
    );
    expect(screen.getByText("00:34–00:42")).toBeInTheDocument();
    expect(
      screen.getByText("Кофе всегда усиливает тревожность."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Употребление кофеина всегда усиливает тревожность."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Эффект зависит от дозы и индивидуальных особенностей."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Общий вывод" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Абсолютная формулировка требует осторожного прочтения/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Открыть источник" }),
    ).toHaveAttribute("href", "https://example.org/review");
  });

  it("switches claim details with the keyboard accessible tab list", () => {
    render(<ReportPreview result={reportResult} />);
    const overallTab = screen.getByRole("tab", { name: "Общий вывод" });
    expect(overallTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(overallTab, { key: "ArrowDown" });

    expect(
      screen.getByRole("tab", { name: /Кофеин всегда усиливает тревожность/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText("Кофе всегда усиливает тревожность."),
    ).toBeInTheDocument();
    expect(screen.getByText("00:34–00:42")).toBeInTheDocument();
    expect(
      screen.getByText(/Абсолютная формулировка требует осторожного прочтения/),
    ).toBeInTheDocument();
  });

  it("does not show demo report content while processing or when no claims were extracted", () => {
    const processing: ReportLoadResult = {
      kind: "processing",
      contentItemId: "content-1",
      fileName: "my-video.mp4",
    };
    const { rerender } = render(<ReportPreview result={processing} />);

    expect(
      screen.getByText(
        "Отчет появится после завершения всех этапов обработки видео.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/влияние кофе на тревожность/i),
    ).not.toBeInTheDocument();

    rerender(
      <ReportPreview
        result={{
          kind: "ready",
          report: { ...reportResult.report, claims: [], narrative: null },
        }}
      />,
    );
    expect(
      screen.getByText(
        "Проверяемых утверждений не найдено, поэтому доказательный вывод по ролику сделать нельзя.",
      ),
    ).toBeInTheDocument();
  });
});

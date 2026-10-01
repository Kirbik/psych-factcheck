import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryPreview } from "@/components/preview/history-preview";
import type { HistoryLoadResult } from "@/features/history/history-contract";

const push = vi.fn();

vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "" }),
  Lora: () => ({ variable: "" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const result: HistoryLoadResult = {
  kind: "ready",
  checks: [
    {
      id: "content-1",
      title: "video.mp4",
      status: "completed",
      claims: "2 из 2",
      date: "1 окт. 2026 г., 20:11",
      action: "Открыть отчёт",
      href: "/report?contentItemId=content-1",
    },
    {
      id: "content-2",
      title: "in-progress.mp4",
      status: "processing",
      claims: "1 из 3",
      date: "1 окт. 2026 г., 20:12",
      action: "Открыть статус",
      href: "/processing?contentItemId=content-2",
    },
  ],
};

describe("HistoryPreview", () => {
  afterEach(() => {
    cleanup();
    push.mockClear();
  });

  it("renders only supplied checks and links completed reports with their content ID", () => {
    render(<HistoryPreview result={result} />);

    expect(screen.getByText("video.mp4")).toBeInTheDocument();
    expect(screen.getByText("in-progress.mp4")).toBeInTheDocument();
    expect(
      screen.queryByText("Влияет ли кофе на уровень тревожности?"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Дополнительные действия: video.mp4",
      }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Просмотреть" }),
    ).toHaveAttribute("href", "/report?contentItemId=content-1");
  });

  it("routes a selected row to its real report or processing URL", () => {
    render(<HistoryPreview result={result} />);

    fireEvent.click(screen.getByText("video.mp4"));

    expect(push).toHaveBeenCalledWith("/report?contentItemId=content-1");
  });

  it("shows an honest empty or unavailable state without mock rows", () => {
    const { rerender } = render(
      <HistoryPreview result={{ kind: "ready", checks: [] }} />,
    );
    expect(
      screen.getByText("Для этого фильтра проверок пока нет."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("row", { name: /Открыть проверку/ }),
    ).not.toBeInTheDocument();

    rerender(<HistoryPreview result={{ kind: "unavailable" }} />);
    expect(
      screen.getByText("Не удалось загрузить список проверок."),
    ).toBeInTheDocument();
  });
});

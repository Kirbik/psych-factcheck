import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadVideoFile = vi.hoisted(() => vi.fn());

vi.mock("@/features/analysis/video-upload-client", () => ({
  uploadVideoFile,
}));

import {
  useVideoUpload,
  VideoUploadProvider,
} from "@/features/analysis/video-upload-provider";

function NewCheckRoute({ onNavigate }: { onNavigate: () => void }) {
  const {
    task,
    startUpload,
    clearTask,
    updateWorkflowStatus,
    isUploadLocked,
  } = useVideoUpload();
  const video = new File(["video"], "lesson.mp4", { type: "video/mp4" });

  return (
    <>
      <button onClick={onNavigate} type="button">
        Проверки
      </button>
      <button
        onClick={() => startUpload(video, "upload-id")}
        type="button"
      >
        Продолжить
      </button>
      <button
        onClick={() => {
          if (task?.result) {
            updateWorkflowStatus(task.result.contentItemId, "running");
          }
        }}
        type="button"
      >
        Отметить обработку активной
      </button>
      <button
        onClick={() => {
          if (task?.result) {
            updateWorkflowStatus(task.result.contentItemId, "completed");
          }
        }}
        type="button"
      >
        Отметить обработку завершённой
      </button>
      <button onClick={clearTask} type="button">
        Очистить текущую проверку
      </button>
      <button
        onClick={() => startUpload(video, "second-upload-id")}
        type="button"
      >
        Начать вторую загрузку
      </button>
      {task ? (
        <p role="status">
          {`${task.fileName}: ${task.status}${task.workflowStatus ? ` / ${task.workflowStatus}` : ""}`}
        </p>
      ) : null}
      <p data-testid="upload-lock">
        {isUploadLocked ? "Загрузка заблокирована" : "Можно загрузить"}
      </p>
    </>
  );
}

function RouteSwitcher() {
  const [route, setRoute] = useState<"new-check" | "history">("new-check");
  return route === "new-check" ? (
    <NewCheckRoute onNavigate={() => setRoute("history")} />
  ) : (
    <>
      <h1>История проверок</h1>
      <button onClick={() => setRoute("new-check")} type="button">
        Новая проверка
      </button>
    </>
  );
}

describe("video upload provider", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    uploadVideoFile.mockReset();
  });

  it("keeps the active upload alive across route changes and restores its state", async () => {
    let completeUpload: (result: {
      contentItemId: string;
      duplicate: boolean;
    }) => void = () => undefined;
    uploadVideoFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeUpload = resolve;
        }),
    );

    render(
      <VideoUploadProvider>
        <RouteSwitcher />
      </VideoUploadProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "lesson.mp4: processing",
    );
    expect(uploadVideoFile).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Проверки" }));
    expect(screen.getByRole("heading", { name: "История проверок" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Новая проверка" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "lesson.mp4: processing",
    );
    expect(uploadVideoFile).toHaveBeenCalledTimes(1);

    completeUpload({ contentItemId: "content-item-id", duplicate: false });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "lesson.mp4: completed",
      ),
    );
  });

  it("blocks a second upload until the background workflow is terminal", async () => {
    uploadVideoFile.mockResolvedValue({
      contentItemId: "content-item-id",
      duplicate: false,
    });

    render(
      <VideoUploadProvider>
        <RouteSwitcher />
      </VideoUploadProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "lesson.mp4: completed / queued",
      ),
    );
    expect(screen.getByTestId("upload-lock")).toHaveTextContent(
      "Загрузка заблокирована",
    );

    fireEvent.click(screen.getByRole("button", { name: "Проверки" }));
    fireEvent.click(screen.getByRole("button", { name: "Новая проверка" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Отметить обработку активной" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Проверки" }));
    fireEvent.click(screen.getByRole("button", { name: "Новая проверка" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Очистить текущую проверку" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Начать вторую загрузку" }),
    );
    expect(uploadVideoFile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "lesson.mp4: completed / running",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Отметить обработку завершённой" }),
    );
    expect(screen.getByTestId("upload-lock")).toHaveTextContent(
      "Можно загрузить",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Очистить текущую проверку" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Начать вторую загрузку" }),
    );
    expect(uploadVideoFile).toHaveBeenCalledTimes(2);
  });
});

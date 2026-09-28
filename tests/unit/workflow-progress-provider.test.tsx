import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const uploadVideoFile = vi.hoisted(() => vi.fn());

vi.mock("@/features/analysis/video-upload-client", () => ({
  uploadVideoFile,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "" }),
  Lora: () => ({ variable: "" }),
}));

import { NewCheckPreview } from "@/components/preview/new-check-preview";
import { WorkflowProgress } from "@/features/analysis/workflow-progress";
import { VideoUploadForm } from "@/features/analysis/video-upload-form";
import {
  useVideoUpload,
  VideoUploadProvider,
} from "@/features/analysis/video-upload-provider";

function UploadAndWorkflow() {
  const { task, startUpload, isUploadLocked } = useVideoUpload();

  return (
    <>
      <button
        onClick={() =>
          startUpload(
            new File(["video"], "lesson.mp4", { type: "video/mp4" }),
            "upload-id",
          )
        }
        type="button"
      >
        Start upload
      </button>
      <p data-testid="upload-lock">{isUploadLocked ? "locked" : "available"}</p>
      <VideoUploadForm />
      {task?.status === "completed" && task.result ? (
        <WorkflowProgress contentItemId={task.result.contentItemId} />
      ) : null}
    </>
  );
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("workflow progress upload lock", () => {
  it("restores a saved video after reload instead of showing the new-upload form", async () => {
    const contentItemId = "33333333-3333-4333-8333-333333333333";
    window.sessionStorage.setItem(
      "psych-factcheck:active-content-item:v1",
      contentItemId,
    );

    let completeStatusRequest: (response: {
      ok: boolean;
      json: () => Promise<unknown>;
    }) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            completeStatusRequest = resolve;
          }),
      ),
    );

    render(
      <VideoUploadProvider>
        <NewCheckPreview />
      </VideoUploadProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Видео загружено" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Продолжить" })).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/api/analysis",
      expect.objectContaining({ method: "POST" }),
    );

    completeStatusRequest({
      ok: true,
      json: async () => ({
        job: {
          id: "44444444-4444-4444-8444-444444444444",
          generation: 1,
          status: "queued",
          stage: "queued",
          attempt: 0,
          error_code: null,
        },
      }),
    });

    expect(
      await screen.findByText(
        "Видео загружено. Подготовка к анализу ожидает запуска.",
      ),
    ).toBeInTheDocument();
    expect(
      window.sessionStorage.getItem("psych-factcheck:active-content-item:v1"),
    ).toBe(contentItemId);
  });

  it("keeps the upload locked until the persisted workflow reports a terminal state", async () => {
    uploadVideoFile.mockResolvedValue({
      contentItemId: "33333333-3333-4333-8333-333333333333",
      duplicate: false,
    });

    let completeWorkflow: (response: {
      ok: boolean;
      json: () => Promise<unknown>;
    }) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            completeWorkflow = resolve;
          }),
      ),
    );

    render(
      <VideoUploadProvider>
        <UploadAndWorkflow />
      </VideoUploadProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start upload" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("upload-lock")).toHaveTextContent("locked");
    expect(screen.getByLabelText("Выбрать файл")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Загрузить видео" }),
    ).toBeDisabled();

    completeWorkflow({
      ok: true,
      json: async () => ({
        job: {
          id: "44444444-4444-4444-8444-444444444444",
          generation: 1,
          status: "completed",
          stage: "complete",
          attempt: 1,
          error_code: null,
        },
      }),
    });

    await waitFor(() =>
      expect(screen.getByTestId("upload-lock")).toHaveTextContent("available"),
    );
    expect(
      window.sessionStorage.getItem("psych-factcheck:active-content-item:v1"),
    ).toBeNull();
    expect(screen.getByLabelText("Выбрать файл")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Загрузить видео" }),
    ).toBeEnabled();
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const uploadVideoFile = vi.hoisted(() => vi.fn());
const fileAccess = vi.hoisted(() => ({
  deleteVideoFileHandle: vi.fn(),
  getVideoFileFromHandle: vi.fn(),
  getStoredVideoFileHandle: vi.fn(),
  pickVideoFileWithHandle: vi.fn(),
  saveVideoFileHandle: vi.fn(),
  supportsPersistentVideoAccess: vi.fn(() => false),
}));
const realtime = vi.hoisted(() => ({
  onChange: null as ((payload: { new: unknown }) => void) | null,
  onStatus: null as ((status: string) => void) | null,
  removeChannel: vi.fn(),
}));

vi.mock("@/features/analysis/video-upload-client", () => ({
  uploadVideoFile,
}));
vi.mock("@/features/analysis/video-file-access", () => fileAccess);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "" }),
  Lora: () => ({ variable: "" }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => {
    const channel = {
      on: (
        _event: string,
        _filter: unknown,
        callback: (payload: { new: unknown }) => void,
      ) => {
        realtime.onChange = callback;
        return channel;
      },
      subscribe: (callback: (status: string) => void) => {
        realtime.onStatus = callback;
        callback("SUBSCRIBED");
        return channel;
      },
    };
    return {
      channel: () => channel,
      removeChannel: realtime.removeChannel,
    };
  },
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
  fileAccess.supportsPersistentVideoAccess.mockReturnValue(false);
  realtime.onChange = null;
  realtime.onStatus = null;
  realtime.removeChannel.mockClear();
});

describe("workflow progress upload lock", () => {
  it("updates workflow progress from a Supabase Realtime event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          realtime: {
            supabaseUrl: "https://example.supabase.co",
            supabaseAnonKey: "public-test-key",
          },
          job: {
            id: "44444444-4444-4444-8444-444444444444",
            generation: 1,
            status: "queued",
            stage: "queued",
            attempt: 0,
            error_code: null,
          },
        }),
      }),
    );

    const { unmount } = render(
      <VideoUploadProvider>
        <WorkflowProgress contentItemId="33333333-3333-4333-8333-333333333333" />
      </VideoUploadProvider>,
    );

    expect(
      await screen.findByText(
        "Видео загружено. Подготовка к анализу ожидает запуска.",
      ),
    ).toBeInTheDocument();
    expect(realtime.onChange).toBeTypeOf("function");
    realtime.onChange?.({
      new: {
        id: "44444444-4444-4444-8444-444444444444",
        generation: 1,
        status: "completed",
        stage: "complete",
        attempt: 1,
        error_code: null,
      },
    });

    expect(
      await screen.findByText(
        "Видео готово к следующим этапам. Транскрипция и анализ пока недоступны.",
      ),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
    unmount();
    expect(realtime.removeChannel).toHaveBeenCalled();
  });

  it("restores interrupted upload progress and resumes with the original file", async () => {
    const uploadId = "55555555-5555-4555-8555-555555555555";
    const file = new File(["video bytes"], "lesson.mp4", {
      type: "video/mp4",
      lastModified: 1234,
    });
    window.sessionStorage.setItem(
      "psych-factcheck:active-content-item:v1",
      JSON.stringify({
        kind: "uploading",
        uploadId,
        fileName: file.name,
        fileSizeBytes: file.size,
        lastModified: file.lastModified,
        progressPercent: 42,
      }),
    );

    let onProgress: (percent: number) => void = () => undefined;
    uploadVideoFile.mockImplementation((_file, _uploadId, reportProgress) => {
      onProgress = reportProgress;
      return new Promise(() => undefined);
    });
    fileAccess.getVideoFileFromHandle.mockResolvedValue(file);
    const handle = { kind: "file", name: file.name };
    fileAccess.getStoredVideoFileHandle.mockResolvedValue(handle);

    render(
      <VideoUploadProvider>
        <NewCheckPreview />
      </VideoUploadProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Загрузка приостановлена" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Приостановлено · 42%")).toBeInTheDocument();

    const resumeButton = await screen.findByRole("button", {
      name: "Продолжить загрузку",
    });
    await waitFor(() => expect(resumeButton).toBeEnabled());
    fireEvent.click(resumeButton);

    await waitFor(() => expect(uploadVideoFile).toHaveBeenCalledTimes(1));
    expect(fileAccess.getStoredVideoFileHandle).toHaveBeenCalledWith(uploadId);
    expect(fileAccess.getVideoFileFromHandle).toHaveBeenCalledWith(handle);
    expect(uploadVideoFile).toHaveBeenCalledWith(
      file,
      uploadId,
      expect.any(Function),
      expect.any(AbortSignal),
    );

    onProgress(68);
    expect(await screen.findByText("Выполняется · 68%")).toBeInTheDocument();
    expect(
      JSON.parse(
        window.sessionStorage.getItem(
          "psych-factcheck:active-content-item:v1",
        ) ?? "null",
      ),
    ).toMatchObject({ kind: "uploading", uploadId, progressPercent: 68 });
  });

  it("does not open the file picker automatically when no saved handle exists", async () => {
    const uploadId = "55555555-5555-4555-8555-555555555555";
    window.sessionStorage.setItem(
      "psych-factcheck:active-content-item:v1",
      JSON.stringify({
        kind: "uploading",
        uploadId,
        fileName: "lesson.mp4",
        fileSizeBytes: 11,
        lastModified: 1234,
        progressPercent: 42,
      }),
    );
    fileAccess.getStoredVideoFileHandle.mockResolvedValue(null);
    const pickerClick = vi.spyOn(HTMLInputElement.prototype, "click");

    render(
      <VideoUploadProvider>
        <NewCheckPreview />
      </VideoUploadProvider>,
    );

    const continueButton = await screen.findByRole("button", {
      name: "Продолжить загрузку",
    });
    await waitFor(() => expect(continueButton).toBeEnabled());
    fireEvent.click(continueButton);

    expect(
      await screen.findByRole("button", {
        name: "Выбрать файл и продолжить",
      }),
    ).toBeInTheDocument();
    expect(pickerClick).not.toHaveBeenCalled();
  });

  it("keeps a file handle, not a file copy, when the browser supports it", async () => {
    const file = new File(["video bytes"], "lesson.mp4", {
      type: "video/mp4",
      lastModified: 1234,
    });
    const handle = { kind: "file", name: file.name };
    fileAccess.supportsPersistentVideoAccess.mockReturnValue(true);
    fileAccess.pickVideoFileWithHandle.mockResolvedValue({ file, handle });
    fileAccess.saveVideoFileHandle.mockResolvedValue(true);
    uploadVideoFile.mockImplementation(() => new Promise(() => undefined));

    const { container } = render(
      <VideoUploadProvider>
        <NewCheckPreview />
      </VideoUploadProvider>,
    );

    fireEvent.click(container.querySelector("#video-file")!);
    await waitFor(() => expect(fileAccess.saveVideoFileHandle).toHaveBeenCalled());
    expect(fileAccess.saveVideoFileHandle).toHaveBeenCalledWith(
      expect.any(String),
      handle,
    );
    expect(await screen.findByText("lesson.mp4")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await waitFor(() => expect(uploadVideoFile).toHaveBeenCalledWith(
      file,
      expect.any(String),
      expect.any(Function),
      expect.any(AbortSignal),
    ));
  });

  it("resumes an interrupted dashboard upload with a manually reselected file", async () => {
    const uploadId = "55555555-5555-4555-8555-555555555555";
    const file = new File(["video bytes"], "lesson.mp4", {
      type: "video/mp4",
      lastModified: 1234,
    });
    window.sessionStorage.setItem(
      "psych-factcheck:active-content-item:v1",
      JSON.stringify({
        kind: "uploading",
        uploadId,
        fileName: file.name,
        fileSizeBytes: file.size,
        lastModified: file.lastModified,
        progressPercent: 42,
      }),
    );
    fileAccess.getVideoFileFromHandle.mockResolvedValue(null);
    uploadVideoFile.mockImplementation(() => new Promise(() => undefined));

    render(
      <VideoUploadProvider>
        <VideoUploadForm />
      </VideoUploadProvider>,
    );

    expect(
      await screen.findByText(
        "Загрузка остановилась после перезагрузки. Нажмите «Продолжить загрузку», чтобы возобновить её.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Выбрать файл"), {
      target: { files: [file] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Продолжить загрузку" }),
    );

    await waitFor(() =>
      expect(uploadVideoFile).toHaveBeenCalledWith(
        file,
        uploadId,
        expect.any(Function),
        expect.any(AbortSignal),
      ),
    );
  });

  it("cancels a restored upload and starts a new file", async () => {
    window.sessionStorage.setItem(
      "psych-factcheck:active-content-item:v1",
      JSON.stringify({
        kind: "uploading",
        uploadId: "55555555-5555-4555-8555-555555555555",
        fileName: "previous.mp4",
        fileSizeBytes: 13,
        lastModified: 1234,
        progressPercent: 42,
      }),
    );
    fileAccess.getStoredVideoFileHandle.mockResolvedValue(null);
    uploadVideoFile.mockImplementation(() => new Promise(() => undefined));

    render(
      <VideoUploadProvider>
        <VideoUploadForm />
      </VideoUploadProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "Отменить загрузку" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отменить загрузку" }));

    const file = new File(["new video"], "replacement.mp4", {
      type: "video/mp4",
      lastModified: 5678,
    });
    fireEvent.change(screen.getByLabelText("Выбрать файл"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить видео" }));

    await waitFor(() =>
      expect(uploadVideoFile).toHaveBeenCalledWith(
        file,
        expect.any(String),
        expect.any(Function),
        expect.any(AbortSignal),
      ),
    );
  });

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

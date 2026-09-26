import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadVideoFile = vi.hoisted(() => vi.fn());

vi.mock("@/features/analysis/video-upload-client", () => ({
  uploadVideoFile,
}));

import {
  useVideoUpload,
  VideoUploadProvider,
} from "@/features/analysis/video-upload-provider";

function NewCheckRoute({ onNavigate }: { onNavigate: () => void }) {
  const { task, startUpload } = useVideoUpload();

  return (
    <>
      <button onClick={onNavigate} type="button">
        Проверки
      </button>
      <button
        onClick={() =>
          startUpload(
            new File(["video"], "lesson.mp4", { type: "video/mp4" }),
            "upload-id",
          )
        }
        type="button"
      >
        Продолжить
      </button>
      {task ? <p role="status">{`${task.fileName}: ${task.status}`}</p> : null}
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
});

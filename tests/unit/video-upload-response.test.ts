import { describe, expect, it } from "vitest";
import { readVideoUploadResponse } from "@/features/analysis/video-upload-client";

describe("readVideoUploadResponse", () => {
  it("accepts a successful upload response", async () => {
    const response = Response.json({
      contentItemId: "content-item-id",
      duplicate: false,
    });

    await expect(readVideoUploadResponse(response)).resolves.toEqual({
      contentItemId: "content-item-id",
      duplicate: false,
    });
  });

  it("uses the server message for a JSON error response", async () => {
    const response = Response.json(
      { error: "Поддерживаются только MP4, WebM и MOV." },
      { status: 400 },
    );

    await expect(readVideoUploadResponse(response)).rejects.toThrow(
      "Поддерживаются только MP4, WebM и MOV.",
    );
  });

  it("returns a readable error when the server responds with HTML", async () => {
    const response = new Response("<html><h1>Bad Gateway</h1></html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });

    await expect(readVideoUploadResponse(response)).rejects.toThrow(
      "Не удалось загрузить видео. Попробуйте ещё раз.",
    );
  });
});

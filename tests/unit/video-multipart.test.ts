// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseBoundedVideoForm } from "@/server/storage/multipart";

describe("bounded video multipart parser", () => {
  it("parses a valid multipart request", async () => {
    const body = [
      "--test-boundary\r\n",
      'Content-Disposition: form-data; name="upload_id"\r\n\r\n',
      "7f6f3a49-3ed4-4c0e-8430-a80b83651045\r\n",
      "--test-boundary\r\n",
      'Content-Disposition: form-data; name="video"; filename="clip.mp4"\r\n',
      "Content-Type: video/mp4\r\n\r\nvideo\r\n",
      "--test-boundary--\r\n",
    ].join("");
    const request = new Request("https://example.test/api/uploads/video", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=test-boundary",
      },
      body,
    });

    const result = await parseBoundedVideoForm(request);
    expect(result).toMatchObject({ success: true });
    if (result.success) {
      expect(result.formData.get("upload_id")).toBe(
        "7f6f3a49-3ed4-4c0e-8430-a80b83651045",
      );
      expect(result.formData.get("video")).toBeInstanceOf(File);
    }
  });

  it("rejects a chunked request as soon as its body exceeds the limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    const request = new Request("https://example.test/api/uploads/video", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body,
      // Request streams require the Node fetch duplex extension.
      duplex: "half",
    } as RequestInit);

    await expect(parseBoundedVideoForm(request, 12)).resolves.toEqual({
      success: false,
      reason: "too-large",
    });
  });

  it("rejects a non-multipart request", async () => {
    const request = new Request("https://example.test/api/uploads/video", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    await expect(parseBoundedVideoForm(request)).resolves.toEqual({
      success: false,
      reason: "invalid",
    });
  });
});

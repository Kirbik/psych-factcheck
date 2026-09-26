// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readBoundedJson } from "@/server/storage/bounded-json";

describe("bounded JSON reader", () => {
  it("parses a small JSON request", async () => {
    const request = new Request("https://example.test/api/uploads/video", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: "lesson.mp4" }),
    });
    await expect(readBoundedJson(request)).resolves.toEqual({
      success: true,
      value: { fileName: "lesson.mp4" },
    });
  });

  it("rejects an oversized streamed request before parsing it", async () => {
    const request = new Request("https://example.test/api/uploads/video", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(8));
          controller.enqueue(new Uint8Array(8));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readBoundedJson(request, 12)).resolves.toEqual({
      success: false,
    });
  });
});

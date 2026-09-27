// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readWorkflowVideoHeader } from "@/server/workflows/video-header";

afterEach(() => vi.unstubAllGlobals());
describe("bounded workflow video header", () => {
  it("accepts a partial header response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array(12), {
            status: 206,
            headers: { "content-range": "bytes 0-11/12" },
          }),
        ),
    );
    expect(
      (await readWorkflowVideoHeader("https://storage.test/signed")).length,
    ).toBe(12);
  });
  it("rejects a server ignoring Range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Uint8Array(20))),
    );
    await expect(
      readWorkflowVideoHeader("https://storage.test/signed"),
    ).rejects.toThrow("unavailable");
  });
  it("caps the stream even with misleading Content-Range", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array(17), {
            status: 206,
            headers: { "content-range": "bytes 0-15/500" },
          }),
        ),
    );
    await expect(
      readWorkflowVideoHeader("https://storage.test/signed"),
    ).rejects.toThrow("size");
  });
});

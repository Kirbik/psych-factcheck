import { afterEach, describe, expect, it, vi } from "vitest";

type MockTusOptions = {
  endpoint?: string | null;
  headers?: Record<string, string>;
  metadata?: Record<string, string>;
  chunkSize?: number;
  onSuccess?: (payload: { lastResponse: object }) => void;
};

const tusOptions = vi.hoisted(() => [] as MockTusOptions[]);

vi.mock("tus-js-client", () => ({
  Upload: class {
    constructor(
      _file: File,
      private options: MockTusOptions,
    ) {
      tusOptions.push(options);
    }

    start() {
      this.options.onSuccess?.({ lastResponse: {} });
    }
  },
}));

import { uploadVideoFile } from "@/features/analysis/video-upload-client";

describe("direct video upload client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    tusOptions.length = 0;
  });

  it("prepares a signed upload, sends via TUS, then requests server verification", async () => {
    // Browser builds may receive no Supabase variables at build time. The
    // authenticated preparation API supplies its runtime public configuration.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          {
            duplicate: false,
            fileMimeType: "video/mp4",
            storageApiKey: "public-test-key",
            storageUploadEndpoint:
              "https://project.supabase.co/storage/v1/upload/resumable/sign",
            storagePath: "owner-id/object-id.mp4",
            token: "single-object-token",
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { contentItemId: "content-item-id", duplicate: false },
          {
            status: 201,
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["video bytes"], "lesson.mp4", {
      type: "video/mp4",
    });
    await expect(uploadVideoFile(file, "upload-id")).resolves.toEqual({
      contentItemId: "content-item-id",
      duplicate: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/uploads/video");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/uploads/video/complete");
    expect(tusOptions).toHaveLength(1);
    expect(tusOptions[0]).toMatchObject({
      endpoint: "https://project.supabase.co/storage/v1/upload/resumable/sign",
      chunkSize: 6 * 1024 * 1024,
      headers: {
        apikey: "public-test-key",
        "x-signature": "single-object-token",
      },
      metadata: {
        bucketName: "videos",
        objectName: "owner-id/object-id.mp4",
        contentType: "video/mp4",
      },
    });
  });
});

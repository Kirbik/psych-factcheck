import { afterEach, describe, expect, it, vi } from "vitest";

type MockTusOptions = {
  endpoint?: string | null;
  headers?: Record<string, string>;
  metadata?: Record<string, string>;
  chunkSize?: number;
  onError?: (error: Error) => void;
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
  fingerprint?: (file: File, options: MockTusOptions) => Promise<string>;
  removeFingerprintOnSuccess?: boolean;
  storeFingerprintForResuming?: boolean;
  onSuccess?: (payload: { lastResponse: object }) => void;
};

const tusOptions = vi.hoisted(() => [] as MockTusOptions[]);
const previousUploads = vi.hoisted(
  () =>
    [] as Array<{
      metadata: Record<string, string>;
      uploadUrl: string;
    }>,
);
const resumedUploads = vi.hoisted(() => [] as string[]);
const abortedUploads = vi.hoisted(() => [] as boolean[]);
const holdTusSuccess = vi.hoisted(() => ({ value: false }));

vi.mock("tus-js-client", () => ({
  Upload: class {
    constructor(
      _file: File,
      private options: MockTusOptions,
    ) {
      tusOptions.push(options);
    }

    start() {
      if (!holdTusSuccess.value) {
        this.options.onSuccess?.({ lastResponse: {} });
      }
    }

    abort(shouldTerminate = false) {
      abortedUploads.push(shouldTerminate);
      return Promise.resolve();
    }

    findPreviousUploads() {
      return Promise.resolve(previousUploads);
    }

    resumeFromPreviousUpload(upload: { uploadUrl: string }) {
      resumedUploads.push(upload.uploadUrl);
    }
  },
}));

import { uploadVideoFile } from "@/features/analysis/video-upload-client";

describe("direct video upload client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    tusOptions.length = 0;
    previousUploads.length = 0;
    resumedUploads.length = 0;
    abortedUploads.length = 0;
    holdTusSuccess.value = false;
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
      storeFingerprintForResuming: true,
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

  it("resumes a matching stored TUS upload before completing the request", async () => {
    previousUploads.push({
      metadata: { objectName: "owner-id/object-id.mp4" },
      uploadUrl: "https://project.supabase.co/upload/previous-session",
    });
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          duplicate: false,
          fileMimeType: "video/mp4",
          storageApiKey: "public-test-key",
          storageUploadEndpoint:
            "https://project.supabase.co/storage/v1/upload/resumable/sign",
          storagePath: "owner-id/object-id.mp4",
          token: "fresh-signature-for-same-object",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ contentItemId: "content-item-id", duplicate: false }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["video bytes"], "lesson.mp4", {
      type: "video/mp4",
    });
    await uploadVideoFile(file, "upload-id");

    expect(resumedUploads).toEqual([
      "https://project.supabase.co/upload/previous-session",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({
        fileName: "lesson.mp4",
        storagePath: "owner-id/object-id.mp4",
        uploadId: "upload-id",
      }),
    });
  });

  it("aborts and terminates an active TUS upload without finalizing it", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        duplicate: false,
        fileMimeType: "video/mp4",
        storageApiKey: "public-test-key",
        storageUploadEndpoint:
          "https://project.supabase.co/storage/v1/upload/resumable/sign",
        storagePath: "owner-id/object-id.mp4",
        token: "single-object-token",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    holdTusSuccess.value = true;
    const controller = new AbortController();
    const upload = uploadVideoFile(
      new File(["video bytes"], "lesson.mp4", { type: "video/mp4" }),
      "upload-id",
      undefined,
      controller.signal,
    );

    await vi.waitFor(() => expect(tusOptions).toHaveLength(1));
    controller.abort();

    await expect(upload).rejects.toMatchObject({ name: "AbortError" });
    expect(abortedUploads).toEqual([true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

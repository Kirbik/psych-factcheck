// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  findByUploadId: vi.fn(),
  info: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}));

vi.mock("@/server/supabase/auth", () => ({
  createServerAuthClient: async () => ({
    auth: { getClaims: mocks.getClaims },
    storage: {
      from: () => ({
        info: mocks.info,
        createSignedUploadUrl: mocks.createSignedUploadUrl,
      }),
    },
  }),
}));
vi.mock("@/server/db/content-items-repository", () => ({
  contentItemsRepository: { findByUploadId: mocks.findByUploadId },
}));
vi.mock("@/lib/supabase-config", () => ({
  getPublicSupabaseConfig: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
  }),
}));

import { POST } from "@/app/api/uploads/video/route";

const userId = "22222222-2222-4222-8222-222222222222";
const uploadId = "33333333-3333-4333-8333-333333333333";

function postUpload() {
  return POST(
    new Request("http://localhost/api/uploads/video", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileName: "lesson.mp4",
        fileSizeBytes: 1024,
        uploadId,
      }),
    }),
  );
}

describe("video upload preparation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: userId } },
      error: null,
    });
    mocks.findByUploadId.mockResolvedValue({ data: null, error: null });
    mocks.info.mockResolvedValue({
      data: null,
      error: { message: "Not found" },
    });
    mocks.createSignedUploadUrl.mockResolvedValue({
      data: { token: "signed-upload-token" },
      error: null,
    });
  });

  it("uses a stable owner-scoped path derived from the upload ID", async () => {
    const response = await postUpload();

    expect(response.status).toBe(201);
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(
      `${userId}/${uploadId}.mp4`,
      { upsert: false },
    );
  });

  it("skips TUS creation when the prior transfer already stored the object", async () => {
    mocks.info.mockResolvedValue({ data: { size: 1024 }, error: null });

    const response = await postUpload();

    expect(await response.json()).toEqual({
      duplicate: false,
      uploaded: true,
      storagePath: `${userId}/${uploadId}.mp4`,
    });
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

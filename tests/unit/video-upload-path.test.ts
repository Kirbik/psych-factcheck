import { describe, expect, it } from "vitest";
import { isOwnedGeneratedVideoPath } from "@/server/storage/video-upload-path";

describe("owned video upload paths", () => {
  const ownerId = "67efb90d-c23a-4c07-8dab-090000000001";
  const otherUserId = "67efb90d-c23a-4c07-8dab-090000000002";

  it("accepts a server-shaped path for its owner", () => {
    expect(
      isOwnedGeneratedVideoPath(
        `${ownerId}/4bdb3891-0a9a-4f2c-8b8a-b72047005001.mp4`,
        ownerId,
      ),
    ).toBe(true);
  });

  it("rejects another user's path and malformed/nested paths", () => {
    expect(
      isOwnedGeneratedVideoPath(
        `${otherUserId}/4bdb3891-0a9a-4f2c-8b8a-b72047005001.mp4`,
        ownerId,
      ),
    ).toBe(false);
    expect(
      isOwnedGeneratedVideoPath(
        `${ownerId}/nested/4bdb3891-0a9a-4f2c-8b8a-b72047005001.mp4`,
        ownerId,
      ),
    ).toBe(false);
    expect(isOwnedGeneratedVideoPath(`${ownerId}/clip.mp4`, ownerId)).toBe(false);
  });
});

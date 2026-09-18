import { describe, expect, it } from "vitest";
import { validateVideoFile, VideoValidationError } from "@/server/storage/video-validator";

function file(name: string, type: string, bytes: number[]) {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("video validator", () => {
  it("accepts a valid MP4 container", async () => {
    const valid = file("lesson.mp4", "video/mp4", [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);
    await expect(validateVideoFile(valid)).resolves.toMatchObject({ extension: ".mp4" });
  });

  it("rejects a spoofed MIME or extension", async () => {
    const spoofed = file("lesson.mp4", "video/mp4", [0, 1, 2, 3, 4, 5, 6, 7]);
    await expect(validateVideoFile(spoofed)).rejects.toBeInstanceOf(VideoValidationError);
  });

  it("rejects unsafe names", async () => {
    const unsafe = file("../lesson.mp4", "video/mp4", [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]);
    await expect(validateVideoFile(unsafe)).rejects.toThrow("имя файла");
  });
});

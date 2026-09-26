import { describe, expect, it } from "vitest";
import {
  validateVideoBytes,
  validateVideoFile,
  validateVideoMetadata,
  VideoValidationError,
} from "@/server/storage/video-validator";

function file(name: string, type: string, bytes: number[]) {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("video validator", () => {
  it("accepts a valid MP4 container", async () => {
    const valid = file("lesson.mp4", "video/mp4", [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);
    await expect(validateVideoFile(valid)).resolves.toMatchObject({ extension: ".mp4" });
  });

  it("rejects invalid container bytes even if the extension and MIME look valid", async () => {
    const spoofed = file("lesson.mp4", "video/mp4", [0, 1, 2, 3, 4, 5, 6, 7]);
    await expect(validateVideoFile(spoofed)).rejects.toBeInstanceOf(VideoValidationError);
  });

  it("derives the stored MIME type from the validated extension, not browser metadata", () => {
    expect(validateVideoMetadata("lesson.mov", 1024)).toMatchObject({
      fileMimeType: "video/quicktime",
      extension: ".mov",
    });
  });

  it("accepts the configured maximum and rejects a larger declared size", () => {
    expect(() => validateVideoMetadata("lesson.mp4", 100 * 1024 * 1024)).not.toThrow();
    expect(() => validateVideoMetadata("lesson.mp4", 100 * 1024 * 1024 + 1)).toThrow(
      "не должен превышать 100 МБ",
    );
  });

  it("validates container signatures independently after Storage upload", () => {
    expect(() =>
      validateVideoBytes(
        new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
        ".mp4",
      ),
    ).not.toThrow();
    expect(() => validateVideoBytes(new Uint8Array([0, 1, 2, 3]), ".webm")).toThrow(
      VideoValidationError,
    );
  });

  it("rejects unsafe names", async () => {
    const unsafe = file("../lesson.mp4", "video/mp4", [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]);
    await expect(validateVideoFile(unsafe)).rejects.toThrow("имя файла");
  });
});

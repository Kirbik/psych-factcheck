import { z } from "zod";

export const VIDEO_BUCKET = "videos";
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;

const fileNameSchema = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (value) =>
      !/[\\/\u0000-\u001f\u007f]/u.test(value) && value === value.trim(),
    "Invalid file name",
  );

const extensionSchema = z.enum([".mp4", ".webm", ".mov"]);

export class VideoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoValidationError";
  }
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function hasBytes(bytes: Uint8Array, offset: number, expected: number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function isSupportedContainer(bytes: Uint8Array, extension: string) {
  if (extension === ".webm")
    return hasBytes(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3]);
  return bytes.length >= 12 && hasBytes(bytes, 4, [0x66, 0x74, 0x79, 0x70]);
}

async function readFileBytes(file: Blob) {
  if (typeof file.arrayBuffer === "function")
    return new Uint8Array(await file.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsArrayBuffer(file);
  });
}

export async function validateVideoFile(file: File) {
  const fileName = fileNameSchema.safeParse(file.name);
  if (!fileName.success)
    throw new VideoValidationError("Недопустимое имя файла.");

  const extension = extensionOf(file.name);
  if (!extensionSchema.safeParse(extension).success) {
    throw new VideoValidationError("Поддерживаются только MP4, WebM и MOV.");
  }
  if (file.size <= 0 || file.size > MAX_VIDEO_SIZE_BYTES) {
    throw new VideoValidationError("Размер видео не должен превышать 100 МБ.");
  }

  const bytes = await readFileBytes(file.slice(0, 16));
  const mimeMatches =
    (extension === ".webm" && file.type === "video/webm") ||
    (extension === ".mov" && file.type === "video/quicktime") ||
    (extension === ".mp4" && file.type === "video/mp4");
  if (!mimeMatches || !isSupportedContainer(bytes, extension)) {
    throw new VideoValidationError(
      "Тип файла не соответствует содержимому видео.",
    );
  }

  return {
    fileName: file.name,
    fileSizeBytes: file.size,
    fileMimeType: file.type,
    extension,
  } as const;
}

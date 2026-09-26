import { MAX_VIDEO_SIZE_BYTES } from "@/server/storage/video-validator";

const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const MAX_VIDEO_REQUEST_BYTES =
  MAX_VIDEO_SIZE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

type FormDataResult =
  | { success: true; formData: FormData }
  | { success: false; reason: "invalid" | "too-large" };

/** Read a bounded multipart body before parsing it, including chunked requests. */
export async function parseBoundedVideoForm(
  request: Request,
  maxRequestBytes = MAX_VIDEO_REQUEST_BYTES,
): Promise<FormDataResult> {
  const contentType = request.headers.get("content-type");
  if (
    !contentType?.toLowerCase().startsWith("multipart/form-data;") ||
    !request.body
  ) {
    return { success: false, reason: "invalid" };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return { success: false, reason: "invalid" };
    }
    if (parsedLength > maxRequestBytes) {
      return { success: false, reason: "too-large" };
    }
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxRequestBytes) {
        await reader.cancel();
        return { success: false, reason: "too-large" };
      }
      chunks.push(value);
    }

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const response = new Response(body, {
      headers: { "content-type": contentType },
    });
    return { success: true, formData: await response.formData() };
  } catch {
    return { success: false, reason: "invalid" };
  } finally {
    reader.releaseLock();
  }
}

import { PermanentWorkflowError } from "./execute";

export async function readWorkflowVideo(
  signedUrl: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const response = await fetch(signedUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Video download unavailable");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body.cancel();
    throw new PermanentWorkflowError("TRANSCRIPTION_FILE_TOO_LARGE");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes)
        throw new PermanentWorkflowError("TRANSCRIPTION_FILE_TOO_LARGE");
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

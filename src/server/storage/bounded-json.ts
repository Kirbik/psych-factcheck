type BoundedJsonResult =
  | { success: true; value: unknown }
  | { success: false };

export async function readBoundedJson(
  request: Request,
  maxBytes = 4096,
): Promise<BoundedJsonResult> {
  if (!request.body) return { success: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { success: false };
      }
      chunks.push(value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { success: true, value: JSON.parse(new TextDecoder().decode(body)) };
  } catch {
    return { success: false };
  } finally {
    reader.releaseLock();
  }
}

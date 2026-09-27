/** Read at most 16 bytes even if Storage ignores Range or sends a misleading header. */
export async function readWorkflowVideoHeader(
  signedUrl: string,
): Promise<Uint8Array> {
  const response = await fetch(signedUrl, {
    headers: { range: "bytes=0-15" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (
    response.status !== 206 ||
    !/^bytes 0-\d+\/\d+$/iu.test(response.headers.get("content-range") ?? "")
  ) {
    await response.body?.cancel();
    throw new Error("Video header unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Video header unavailable");
  const bytes = new Uint8Array(16);
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (length + part.value.length > 16)
        throw new Error("Unexpected video header size");
      bytes.set(part.value, length);
      length += part.value.length;
    }
    return bytes.slice(0, length);
  } finally {
    await reader.cancel();
  }
}

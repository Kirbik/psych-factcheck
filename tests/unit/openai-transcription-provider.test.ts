import { describe, expect, it, vi } from "vitest";
import {
  createOpenAITranscriptionProvider,
  MAX_OPENAI_TRANSCRIPTION_BYTES,
  OPENAI_TRANSCRIPTION_MODEL,
  TranscriptionProviderError,
} from "@/server/ai/openai-transcription-provider";

const input = {
  fileName: "lesson.mp4",
  contentType: "video/mp4",
  bytes: new Uint8Array([1, 2, 3]),
};

function successfulResponse(
  body: unknown = {
    language: "ru",
    segments: [{ start: 0, end: 1.25, text: "Психологическое утверждение." }],
  },
) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("OpenAI transcription provider", () => {
  it("requests Whisper segment timestamps and maps validated Russian output", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(successfulResponse());
    const provider = createOpenAITranscriptionProvider("test-key", fetcher);

    await expect(provider.transcribe(input)).resolves.toEqual({
      language: "ru",
      segments: [
        {
          startSeconds: 0,
          endSeconds: 1.25,
          text: "Психологическое утверждение.",
        },
      ],
    });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init?.headers).toEqual({ Authorization: "Bearer test-key" });
    const form = init?.body as FormData;
    expect(form.get("model")).toBe(OPENAI_TRANSCRIPTION_MODEL);
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("timestamp_granularities[]")).toBe("segment");
    expect(form.get("file")).toBeInstanceOf(File);
  });

  it("rejects malformed segment timestamps and empty output", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        successfulResponse({ segments: [{ start: 2, end: 1, text: "bad" }] }),
      );
    const provider = createOpenAITranscriptionProvider("test-key", fetcher);

    await expect(provider.transcribe(input)).rejects.toMatchObject({
      code: "TRANSCRIPTION_INVALID_RESPONSE",
      retryable: false,
    });
  });

  it("classifies rate limits as retryable without exposing provider response text", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("private provider detail", { status: 429 }),
      );
    const provider = createOpenAITranscriptionProvider("test-key", fetcher);

    await expect(provider.transcribe(input)).rejects.toMatchObject({
      code: "TRANSCRIPTION_PROVIDER_UNAVAILABLE",
      retryable: true,
      message: "TRANSCRIPTION_PROVIDER_UNAVAILABLE",
    });
  });

  it("classifies request timeouts as retryable", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("timeout"));
    const provider = createOpenAITranscriptionProvider("test-key", fetcher);

    await expect(provider.transcribe(input)).rejects.toMatchObject({
      code: "TRANSCRIPTION_PROVIDER_UNAVAILABLE",
      retryable: true,
    });
  });

  it.each([
    [undefined, input, "OPENAI_NOT_CONFIGURED"],
    [
      "test-key",
      { ...input, fileName: "lesson.mov", contentType: "video/quicktime" },
      "TRANSCRIPTION_UNSUPPORTED_INPUT",
    ],
    [
      "test-key",
      { ...input, bytes: new Uint8Array(MAX_OPENAI_TRANSCRIPTION_BYTES + 1) },
      "TRANSCRIPTION_FILE_TOO_LARGE",
    ],
  ] as const)(
    "rejects unsupported setup or media before network access",
    async (key, media, code) => {
      const fetcher = vi.fn<typeof fetch>();
      const provider = createOpenAITranscriptionProvider(key, fetcher);

      const error = provider.transcribe(media);
      await expect(error).rejects.toBeInstanceOf(TranscriptionProviderError);
      await expect(error).rejects.toMatchObject({ code });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

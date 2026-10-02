import { z } from "zod";
import type { TranscriptionProvider, TranscriptionResult } from "./providers";
import { MAX_VIDEO_SIZE_BYTES } from "@/server/storage/video-constraints";

export const OPENAI_TRANSCRIPTION_MODEL = "whisper-1";
export const MAX_OPENAI_TRANSCRIPTION_BYTES = MAX_VIDEO_SIZE_BYTES;

const transcriptionResponseSchema = z.object({
  language: z.string().min(1).nullable().optional(),
  segments: z
    .array(
      z
        .object({
          start: z.number().finite().nonnegative(),
          end: z.number().finite().nonnegative(),
          text: z.string().refine((value) => value.trim().length > 0),
        })
        .refine((segment) => segment.end >= segment.start),
    )
    .min(1),
});

export class TranscriptionProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "TranscriptionProviderError";
  }
}

function supportedInput(fileName: string, contentType: string) {
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return (
    (extension === ".mp4" && contentType === "video/mp4") ||
    (extension === ".webm" && contentType === "video/webm")
  );
}

export function createOpenAITranscriptionProvider(
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
): TranscriptionProvider {
  return {
    async transcribe(input): Promise<TranscriptionResult> {
      if (!apiKey)
        throw new TranscriptionProviderError("OPENAI_NOT_CONFIGURED", false);
      if (input.bytes.byteLength > MAX_OPENAI_TRANSCRIPTION_BYTES)
        throw new TranscriptionProviderError(
          "TRANSCRIPTION_FILE_TOO_LARGE",
          false,
        );
      if (!supportedInput(input.fileName, input.contentType))
        throw new TranscriptionProviderError(
          "TRANSCRIPTION_UNSUPPORTED_INPUT",
          false,
        );

      const form = new FormData();
      const fileBytes = Uint8Array.from(input.bytes);
      form.append(
        "file",
        new Blob([fileBytes.buffer], { type: input.contentType }),
        input.fileName,
      );
      form.append("model", OPENAI_TRANSCRIPTION_MODEL);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");

      let response: Response;
      try {
        response = await fetcher(
          "https://api.openai.com/v1/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
            signal: AbortSignal.timeout(180_000),
          },
        );
      } catch {
        throw new TranscriptionProviderError(
          "TRANSCRIPTION_PROVIDER_UNAVAILABLE",
          true,
        );
      }

      if (!response.ok) {
        if (response.status === 413)
          throw new TranscriptionProviderError(
            "TRANSCRIPTION_FILE_TOO_LARGE",
            false,
          );
        if ([400, 415, 422].includes(response.status))
          throw new TranscriptionProviderError(
            "TRANSCRIPTION_UNSUPPORTED_INPUT",
            false,
          );
        if ([401, 403].includes(response.status))
          throw new TranscriptionProviderError("OPENAI_CONFIGURATION", false);
        throw new TranscriptionProviderError(
          "TRANSCRIPTION_PROVIDER_UNAVAILABLE",
          true,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new TranscriptionProviderError(
          "TRANSCRIPTION_INVALID_RESPONSE",
          false,
        );
      }
      const parsed = transcriptionResponseSchema.safeParse(payload);
      if (!parsed.success)
        throw new TranscriptionProviderError(
          "TRANSCRIPTION_INVALID_RESPONSE",
          false,
        );

      return {
        language: parsed.data.language ?? null,
        segments: parsed.data.segments.map((segment) => ({
          startSeconds: segment.start,
          endSeconds: segment.end,
          text: segment.text,
        })),
      };
    },
  };
}

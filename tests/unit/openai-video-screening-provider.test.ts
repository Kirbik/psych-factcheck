import { describe, expect, it, vi } from "vitest";
import {
  createOpenAIVideoScreeningProvider,
  VideoScreeningProviderError,
} from "@/server/ai/openai-video-screening-provider";
import {
  getAudioTrackDuration,
  getScreeningSampleRanges,
  SCREENING_CLASSIFIER_MODEL,
  SCREENING_SAMPLE_MODEL,
  type ScreeningAudioSample,
} from "@/server/ai/video-screening";

const video = {
  bytes: new Uint8Array([1, 2, 3, 4]),
  contentType: "video/mp4" as const,
};

const sample: ScreeningAudioSample = {
  bytes: new Uint8Array([9, 8, 7]),
  fileName: "screening-sample.mp4",
  contentType: "audio/mp4",
  durationSeconds: 12,
};

const relevant = {
  decision: "relevant",
  reasonCode: "target_topics_present",
  confidence: 0.96,
  rationale: "Excerpts contain substantive psychology discussion.",
};

function response(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200 });
}

function modelResponse(value: unknown) {
  return response({
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      },
    ],
  });
}

function sampleExtractor() {
  return vi.fn().mockResolvedValue(sample);
}

describe("video topic screening", () => {
  it("computes audio duration from packets when container metadata omits it", async () => {
    const computeDuration = vi.fn().mockResolvedValue(37.5);

    await expect(
      getAudioTrackDuration({
        getDurationFromMetadata: vi.fn().mockResolvedValue(null),
        computeDuration,
      }),
    ).resolves.toBe(37.5);
    expect(computeDuration).toHaveBeenCalledOnce();
  });

  it("uses valid metadata duration without scanning packets", async () => {
    const computeDuration = vi.fn();

    await expect(
      getAudioTrackDuration({
        getDurationFromMetadata: vi.fn().mockResolvedValue(37.5),
        computeDuration,
      }),
    ).resolves.toBe(37.5);
    expect(computeDuration).not.toHaveBeenCalled();
  });

  it("screens short videos in full and uses three samples for longer videos", () => {
    expect(getScreeningSampleRanges(0)).toEqual([]);
    expect(getScreeningSampleRanges(8)).toEqual([
      { startSeconds: 0, endSeconds: 8 },
    ]);
    expect(getScreeningSampleRanges(100)).toEqual([
      { startSeconds: 8, endSeconds: 12 },
      { startSeconds: 48, endSeconds: 52 },
      { startSeconds: 88, endSeconds: 92 },
    ]);
  });

  it("transcribes only the remuxed sample and requests strict structured screening", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ text: "Психология памяти и поведения." }),
      )
      .mockResolvedValueOnce(modelResponse(relevant));
    const extract = sampleExtractor();
    const provider = createOpenAIVideoScreeningProvider(
      "test-secret",
      fetcher,
      extract,
    );

    await expect(provider.screen(video)).resolves.toMatchObject({
      ...relevant,
      sampleDurationSeconds: 12,
      provider: "openai",
      sampleModel: SCREENING_SAMPLE_MODEL,
      classifierModel: SCREENING_CLASSIFIER_MODEL,
    });

    expect(extract).toHaveBeenCalledExactlyOnceWith(video.bytes, "video/mp4");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.openai.com/v1/audio/transcriptions",
    );
    const transcriptionRequest = fetcher.mock.calls[0]?.[1];
    const form = transcriptionRequest?.body as FormData;
    const sampleFile = form.get("file") as File;
    expect(sampleFile.name).toBe("screening-sample.mp4");
    expect(sampleFile.size).toBe(sample.bytes.byteLength);
    expect(form.get("model")).toBe(SCREENING_SAMPLE_MODEL);
    expect(form.get("response_format")).toBe("json");
    expect(transcriptionRequest?.headers).toEqual({
      Authorization: "Bearer test-secret",
    });

    const classificationRequest = fetcher.mock.calls[1]?.[1];
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api.openai.com/v1/responses",
    );
    expect(classificationRequest?.headers).toEqual({
      Authorization: "Bearer test-secret",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(classificationRequest?.body)) as {
      model: string;
      store: boolean;
      input: string;
      text: {
        format: { strict: boolean; schema: { additionalProperties: boolean } };
      };
      instructions: string;
    };
    expect(body).toMatchObject({
      model: SCREENING_CLASSIFIER_MODEL,
      store: false,
      input: expect.stringContaining("Психология памяти"),
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(body.text.format.schema.additionalProperties).toBe(false);
    expect(body.instructions).toContain("романтические отношения взрослых");
    expect(body.instructions).toContain("сексуальное здоровье взрослых");
  });

  it("returns uncertain for missing sample transcript or invalid structured output", async () => {
    const emptyTranscript = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ text: " " }));
    await expect(
      createOpenAIVideoScreeningProvider(
        "key",
        emptyTranscript,
        sampleExtractor(),
      ).screen(video),
    ).resolves.toMatchObject({
      decision: "uncertain",
      reasonCode: "invalid_model_output",
    });
    expect(emptyTranscript).toHaveBeenCalledOnce();

    const invalidOutput = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ text: "talk about emotions" }))
      .mockResolvedValueOnce(
        modelResponse({
          decision: "unrelated",
          reasonCode: "target_topics_present",
          confidence: 0.99,
          rationale: "Mismatch.",
        }),
      );
    await expect(
      createOpenAIVideoScreeningProvider(
        "key",
        invalidOutput,
        sampleExtractor(),
      ).screen(video),
    ).resolves.toMatchObject({
      decision: "uncertain",
      reasonCode: "invalid_model_output",
    });
  });

  it("fails open when the sample cannot be extracted", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const extractor = vi.fn().mockResolvedValue(null);

    await expect(
      createOpenAIVideoScreeningProvider("key", fetcher, extractor).screen(
        video,
      ),
    ).resolves.toMatchObject({
      decision: "uncertain",
      reasonCode: "sample_unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not expose provider response details when screening API fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("private provider detail", { status: 429 }),
      );
    const error = createOpenAIVideoScreeningProvider(
      "secret",
      fetcher,
      sampleExtractor(),
    ).screen(video);

    await expect(error).rejects.toBeInstanceOf(VideoScreeningProviderError);
    await expect(error).rejects.toMatchObject({
      code: "SCREENING_PROVIDER_UNAVAILABLE",
      message: "SCREENING_PROVIDER_UNAVAILABLE",
    });
  });

  it("does not invoke sample extraction or OpenAI without the server key", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const extractor = sampleExtractor();
    const screening = createOpenAIVideoScreeningProvider(
      undefined,
      fetcher,
      extractor,
    ).screen(video);

    await expect(screening).rejects.toMatchObject({
      code: "OPENAI_NOT_CONFIGURED",
    });
    expect(extractor).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

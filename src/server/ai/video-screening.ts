import {
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedPacketSink,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  WEBM,
  WebMOutputFormat,
} from "mediabunny";
import { z } from "zod";

export const SCREENING_VERSION = "topic-screening-v2";
export const SCREENING_SAMPLE_MODEL = "whisper-1";
export const SCREENING_CLASSIFIER_MODEL = "gpt-4o-mini";
export const SCREENING_INSTRUCTIONS_VERSION = "topic-screening-instructions-v2";
export const SCREENING_SAMPLE_CLIP_SECONDS = 4;
export const SCREENING_SAMPLE_CLIP_COUNT = 3;
export const SCREENING_MAX_SAMPLE_BYTES = 2_000_000;
export const SCREENING_REJECTION_CONFIDENCE = 0.9;

export const screeningReasonCodes = [
  "no_target_topic_content",
  "incidental_mention",
  "no_checkable_claims",
  "target_topics_present",
  "unclear_sample",
  "sample_unavailable",
  "provider_error",
  "invalid_model_output",
] as const;

export type ScreeningReasonCode = (typeof screeningReasonCodes)[number];

export type VideoScreening = {
  readonly decision: "relevant" | "unrelated" | "uncertain";
  readonly reasonCode: ScreeningReasonCode;
  readonly confidence: number;
  readonly rationale: string;
  readonly sampleDurationSeconds: number;
  readonly provider: "openai";
  readonly sampleModel: typeof SCREENING_SAMPLE_MODEL;
  readonly classifierModel: typeof SCREENING_CLASSIFIER_MODEL;
  readonly instructionsVersion: typeof SCREENING_INSTRUCTIONS_VERSION;
};

export const videoScreeningSchema = z
  .object({
    decision: z.enum(["relevant", "unrelated", "uncertain"]),
    reasonCode: z.enum(screeningReasonCodes),
    confidence: z.number().finite().min(0).max(1),
    rationale: z.string().max(240),
    sampleDurationSeconds: z.number().finite().min(0).max(12),
    provider: z.literal("openai"),
    sampleModel: z.literal(SCREENING_SAMPLE_MODEL),
    classifierModel: z.literal(SCREENING_CLASSIFIER_MODEL),
    instructionsVersion: z.literal(SCREENING_INSTRUCTIONS_VERSION),
  })
  .strict();

export type ScreeningAudioSample = {
  readonly bytes: Uint8Array;
  readonly fileName: "screening-sample.mp4" | "screening-sample.webm";
  readonly contentType: "audio/mp4" | "audio/webm";
  readonly durationSeconds: number;
};

export function getScreeningSampleRanges(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];

  // Short clips are cheap to screen in full and avoid silently bypassing the
  // topic check for videos that would otherwise go straight to transcription.
  if (durationSeconds <= SCREENING_SAMPLE_CLIP_SECONDS * 3) {
    return [{ startSeconds: 0, endSeconds: durationSeconds }];
  }

  const clipDuration = SCREENING_SAMPLE_CLIP_SECONDS;
  const sampleCenters = [0.1, 0.5, 0.9].map((fraction) =>
    Math.min(
      durationSeconds - clipDuration / 2,
      Math.max(clipDuration / 2, durationSeconds * fraction),
    ),
  );

  return sampleCenters.map((center) => ({
    startSeconds: center - clipDuration / 2,
    endSeconds: center + clipDuration / 2,
  }));
}

export async function getAudioTrackDuration(track: {
  getDurationFromMetadata: () => Promise<number | null>;
  computeDuration: () => Promise<number>;
}): Promise<number | null> {
  const durationSeconds =
    (await track.getDurationFromMetadata()) ?? (await track.computeDuration());

  return Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : null;
}

/**
 * Remuxes only three short ranges from the video's existing compressed audio track.
 * It does not decode video/audio, invoke a system binary, or send source video bytes
 * to OpenAI. Unsupported/missing audio is handled as an unavailable sample upstream.
 */
export async function extractScreeningAudioSample(
  bytes: Uint8Array,
  contentType: "video/mp4" | "video/webm",
): Promise<ScreeningAudioSample | null> {
  const input = new Input({
    formats: [contentType === "video/mp4" ? MP4 : WEBM],
    source: new BufferSource(bytes),
  });
  let output: Output | undefined;

  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;

    const codec = await track.getCodec();
    if (!codec) return null;
    const isMp4 = contentType === "video/mp4";
    if (
      (isMp4 && codec !== "aac") ||
      (!isMp4 && codec !== "opus" && codec !== "vorbis")
    ) {
      return null;
    }

    const durationSeconds = await getAudioTrackDuration(track);
    if (durationSeconds === null) return null;
    const ranges = getScreeningSampleRanges(durationSeconds);
    if (ranges.length === 0) return null;

    const decoderConfig = await track.getDecoderConfig();
    if (!decoderConfig) return null;

    const target = new BufferTarget();
    const source = new EncodedAudioPacketSource(codec);
    output = new Output({
      format: isMp4 ? new Mp4OutputFormat() : new WebMOutputFormat(),
      target,
    });
    output.addAudioTrack(source);
    await output.start();

    const sink = new EncodedPacketSink(track);
    let outputTimestamp = 0;
    let sampleBytes = 0;
    let packetCount = 0;

    for (const range of ranges) {
      const firstPacket = await sink.getPacket(range.startSeconds);
      if (!firstPacket) continue;

      const rangeStart = firstPacket.timestamp;
      let packet: EncodedPacket | null = firstPacket;
      while (packet && packet.timestamp < range.endSeconds) {
        sampleBytes += packet.byteLength;
        packetCount += 1;
        if (sampleBytes > SCREENING_MAX_SAMPLE_BYTES || packetCount > 10_000) {
          await output.cancel();
          output = undefined;
          return null;
        }

        const shifted = packet.clone({
          timestamp: outputTimestamp + packet.timestamp - rangeStart,
        });
        await source.add(
          shifted,
          packetCount === 1 ? { decoderConfig } : undefined,
        );
        outputTimestamp = shifted.timestamp + shifted.duration;
        packet = await sink.getNextPacket(packet);
      }
    }

    if (packetCount === 0) {
      await output.cancel();
      output = undefined;
      return null;
    }

    source.close();
    await output.finalize();
    output = undefined;
    if (!target.buffer || target.buffer.byteLength > SCREENING_MAX_SAMPLE_BYTES)
      return null;

    return {
      bytes: new Uint8Array(target.buffer),
      fileName: isMp4 ? "screening-sample.mp4" : "screening-sample.webm",
      contentType: isMp4 ? "audio/mp4" : "audio/webm",
      durationSeconds: Math.min(
        ranges.reduce(
          (total, range) => total + range.endSeconds - range.startSeconds,
          0,
        ),
        durationSeconds,
      ),
    };
  } finally {
    await output?.cancel();
    input.dispose();
  }
}

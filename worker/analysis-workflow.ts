import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  jobPayloadSchema,
  type JobPayload,
} from "@/features/analysis/job-contract";
import {
  executeClaimExtractionStage,
  executeScreeningStage,
  executeTranscriptionStage,
  PermanentWorkflowError,
} from "@/server/workflows/execute";
import { workflowRepository } from "@/server/workflows/repository";
import { VIDEO_BUCKET } from "@/server/storage/video-validator";
import {
  createOpenAITranscriptionProvider,
  MAX_OPENAI_TRANSCRIPTION_BYTES,
  TranscriptionProviderError,
} from "@/server/ai/openai-transcription-provider";
import {
  createOpenAIVideoScreeningProvider,
  uncertainScreening,
} from "@/server/ai/openai-video-screening-provider";
import {
  createOpenAIClaimExtractionProvider,
  ClaimExtractionProviderError,
} from "@/server/ai/openai-claim-extraction-provider";
import { readWorkflowVideoHeader } from "@/server/workflows/video-header";
import { readWorkflowVideo } from "@/server/workflows/video-download";
import { createWorkerClient } from "./client";

export class AnalysisWorkflow extends WorkflowEntrypoint<
  Record<string, unknown>,
  JobPayload
> {
  async run(event: WorkflowEvent<JobPayload>, step: WorkflowStep) {
    const payload = jobPayloadSchema.parse(event.payload);
    const repository = workflowRepository(createWorkerClient(this.env));
    const apiKey =
      typeof this.env.OPENAI_API_KEY === "string"
        ? this.env.OPENAI_API_KEY
        : undefined;
    const transcriptionProvider = createOpenAITranscriptionProvider(apiKey);
    const screeningProvider = createOpenAIVideoScreeningProvider(apiKey);
    const claimExtractionProvider = createOpenAIClaimExtractionProvider(apiKey);
    let attempt = 1;
    let failureCode: string | undefined;

    const inspectVideo = async (path: string) => {
      const client = createWorkerClient(this.env);
      const { data, error } = await client.storage
        .from(VIDEO_BUCKET)
        .info(path);
      if (error || !data) {
        if (
          error &&
          "statusCode" in error &&
          String(error.statusCode) === "404"
        )
          throw new PermanentWorkflowError("UPLOAD_MISSING");
        throw new Error("Storage unavailable");
      }
      const signed = await client.storage
        .from(VIDEO_BUCKET)
        .createSignedUrl(path, 60);
      if (signed.error || !signed.data)
        throw new Error("Video verification unavailable");
      return {
        size: Number(data.size),
        header: await readWorkflowVideoHeader(signed.data.signedUrl),
      };
    };

    const downloadVideo = async (storagePath: string, ttlSeconds: number) => {
      const client = createWorkerClient(this.env);
      const signed = await client.storage
        .from(VIDEO_BUCKET)
        .createSignedUrl(storagePath, ttlSeconds);
      if (signed.error || !signed.data)
        throw new Error("Video download unavailable");
      return readWorkflowVideo(
        signed.data.signedUrl,
        MAX_OPENAI_TRANSCRIPTION_BYTES,
      );
    };

    try {
      const screening = await step.do(
        "screen uploaded video topic",
        {
          retries: {
            limit: 2,
            delay: "1 second",
            backoff: "exponential",
          },
          timeout: "4 minutes",
        },
        async (context) => {
          attempt = context.attempt;
          try {
            return await executeScreeningStage(
              payload,
              event.instanceId,
              context.attempt,
              repository,
              inspectVideo,
              async (input) => {
                const bytes = await downloadVideo(input.storagePath, 180);
                if (
                  input.contentType !== "video/mp4" &&
                  input.contentType !== "video/webm"
                ) {
                  return uncertainScreening("sample_unavailable");
                }
                return screeningProvider.screen({
                  bytes,
                  contentType: input.contentType,
                });
              },
            );
          } catch (error) {
            if (error instanceof PermanentWorkflowError) {
              failureCode = error.message;
              throw new NonRetryableError(error.message);
            }
            throw error;
          }
        },
      );
      if (
        screening.outcome === "obsolete" ||
        screening.outcome === "screened_out"
      )
        return screening;

      if (screening.outcome === "ready_for_transcription") {
        const transcription = await step.do(
          "transcribe screened video",
          {
            retries: {
              limit: 2,
              delay: "1 second",
              backoff: "exponential",
            },
            timeout: "4 minutes",
          },
          async (context) => {
            attempt = context.attempt;
            try {
              return await executeTranscriptionStage(
                payload,
                event.instanceId,
                context.attempt,
                repository,
                inspectVideo,
                async (input) => {
                  try {
                    const bytes = await downloadVideo(input.storagePath, 300);
                    return await transcriptionProvider.transcribe({
                      fileName: input.fileName,
                      contentType: input.contentType,
                      bytes,
                    });
                  } catch (error) {
                    if (error instanceof TranscriptionProviderError) {
                      failureCode = error.code;
                      if (!error.retryable)
                        throw new NonRetryableError(error.code);
                      throw error;
                    }
                    throw error;
                  }
                },
              );
            } catch (error) {
              if (error instanceof PermanentWorkflowError) {
                failureCode = error.message;
                throw new NonRetryableError(error.message);
              }
              throw error;
            }
          },
        );
        if (transcription.outcome !== "ready_for_claim_extraction")
          return transcription;
      }

      return await step.do(
        "extract claims from transcript",
        {
          retries: {
            limit: 2,
            delay: "1 second",
            backoff: "exponential",
          },
          timeout: "4 minutes",
        },
        async (context) => {
          attempt = context.attempt;
          try {
            return await executeClaimExtractionStage(
              payload,
              event.instanceId,
              context.attempt,
              repository,
              claimExtractionProvider,
            );
          } catch (error) {
            if (error instanceof ClaimExtractionProviderError) {
              failureCode = error.code;
              if (error.code === "CLAIM_OUTPUT_INVALID") {
                console.error("[analysis] Claim extraction output rejected", {
                  jobId: payload.jobId,
                  validationIssue: error.validationIssue,
                });
              }
              if (!error.retryable) throw new NonRetryableError(error.code);
              throw error;
            }
            if (error instanceof PermanentWorkflowError) {
              failureCode = error.message;
              throw new NonRetryableError(error.message);
            }
            throw error;
          }
        },
      );
    } catch (error) {
      await repository.advance(
        payload,
        event.instanceId,
        "failed",
        attempt,
        failureCode ??
          (error instanceof NonRetryableError
            ? error.message
            : "WORKFLOW_FAILED"),
      );
      throw error;
    }
  }
}

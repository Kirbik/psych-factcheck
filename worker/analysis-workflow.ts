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
  executeWorkflow,
  PermanentWorkflowError,
} from "@/server/workflows/execute";
import { workflowRepository } from "@/server/workflows/repository";
import { VIDEO_BUCKET } from "@/server/storage/video-validator";
import {
  createOpenAITranscriptionProvider,
  MAX_OPENAI_TRANSCRIPTION_BYTES,
  TranscriptionProviderError,
} from "@/server/ai/openai-transcription-provider";
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
    let attempt = 1;

    try {
      return await step.do(
        "prepare uploaded video",
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
            return await executeWorkflow(
              payload,
              event.instanceId,
              context.attempt,
              repository,
              async (path) => {
                const client = createWorkerClient(this.env);
                const { data, error } = await client.storage
                  .from(VIDEO_BUCKET)
                  .info(path);
                if (error || !data) {
                  if (
                    error &&
                    "statusCode" in error &&
                    String(error.statusCode) === "404"
                  ) {
                    throw new PermanentWorkflowError("UPLOAD_MISSING");
                  }
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
              },
              async (input) => {
                if (input.size > MAX_OPENAI_TRANSCRIPTION_BYTES)
                  throw new PermanentWorkflowError(
                    "TRANSCRIPTION_FILE_TOO_LARGE",
                  );
                const client = createWorkerClient(this.env);
                const signed = await client.storage
                  .from(VIDEO_BUCKET)
                  .createSignedUrl(input.storagePath, 300);
                if (signed.error || !signed.data)
                  throw new Error("Video download unavailable");
                const bytes = await readWorkflowVideo(
                  signed.data.signedUrl,
                  MAX_OPENAI_TRANSCRIPTION_BYTES,
                );
                try {
                  return await transcriptionProvider.transcribe({
                    fileName: input.fileName,
                    contentType: input.contentType,
                    bytes,
                  });
                } catch (error) {
                  if (error instanceof TranscriptionProviderError) {
                    if (!error.retryable)
                      throw new NonRetryableError(error.code);
                    throw error;
                  }
                  throw error;
                }
              },
            );
          } catch (error) {
            if (error instanceof PermanentWorkflowError)
              throw new NonRetryableError(error.message);
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
        error instanceof NonRetryableError ? error.message : "WORKFLOW_FAILED",
      );
      throw error;
    }
  }
}

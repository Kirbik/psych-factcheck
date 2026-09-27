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
import { readWorkflowVideoHeader } from "@/server/workflows/video-header";
import { createWorkerClient } from "./client";

export class AnalysisWorkflow extends WorkflowEntrypoint<
  Record<string, unknown>,
  JobPayload
> {
  async run(event: WorkflowEvent<JobPayload>, step: WorkflowStep) {
    const payload = jobPayloadSchema.parse(event.payload);
    const repository = workflowRepository(createWorkerClient(this.env));
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
          timeout: "60 seconds",
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
            );
          } catch (error) {
            if (error instanceof PermanentWorkflowError)
              throw new NonRetryableError(error.message);
            throw error;
          }
        },
      );
    } catch (error) {
      if (!(error instanceof NonRetryableError)) {
        await repository.advance(
          payload,
          event.instanceId,
          "failed",
          attempt,
          "WORKFLOW_FAILED",
        );
      }
      throw error;
    }
  }
}

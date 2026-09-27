import { AbortTaskRunError, schemaTask, schedules } from "@trigger.dev/sdk";
import {
  ANALYSIS_TASK_ID,
  jobPayloadSchema,
} from "@/features/analysis/job-contract";
import {
  executeWorkflow,
  PermanentWorkflowError,
} from "@/server/workflows/execute";
import { workflowRepository } from "@/server/workflows/repository";
import { reconcileJob } from "@/server/workflows/dispatch";
import { triggerRunner } from "@/server/workflows/trigger-runner";
import { VIDEO_BUCKET } from "@/server/storage/video-validator";
import { createWorkerClient } from "./client";
import { readWorkflowVideoHeader } from "@/server/workflows/video-header";

export const analysisWorkflow = schemaTask({
  id: ANALYSIS_TASK_ID,
  schema: jobPayloadSchema,
  maxDuration: 60,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
    factor: 2,
    randomize: true,
  },
  run: async (payload, { ctx }) => {
    const client = createWorkerClient();
    const repository = workflowRepository(client);
    try {
      return await executeWorkflow(
        payload,
        ctx.run.id,
        ctx.attempt.number,
        repository,
        async (path) => {
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
      if (error instanceof PermanentWorkflowError) {
        await repository.advance(
          payload,
          ctx.run.id,
          "failed",
          ctx.attempt.number,
          error.message,
        );
        throw new AbortTaskRunError(error.message);
      }
      throw error;
    }
  },
  onFailure: async ({ payload, ctx }) => {
    await workflowRepository(createWorkerClient()).advance(
      payload,
      ctx.run.id,
      "failed",
      ctx.attempt.number,
      "WORKFLOW_FAILED",
    );
  },
});

// Recovers the DB/enqueue gap and terminal runs whose failure hook could not write.
export const reconcileAnalysis = schedules.task({
  id: "reconcile-analysis-jobs",
  cron: "* * * * *",
  maxDuration: 120,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    const repository = workflowRepository(createWorkerClient());
    const jobs = await repository.active();
    const results = await Promise.allSettled(
      jobs.map((job) => reconcileJob(job, repository, triggerRunner)),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Job reconciliation incomplete");
    return { checked: jobs.length };
  },
});

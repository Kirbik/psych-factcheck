import { isActiveJob, type JobPayload } from "@/features/analysis/job-contract";
import type { AnalysisJob, WorkflowRepository } from "./repository";

export interface WorkflowRunner {
  trigger(payload: JobPayload, key: string): Promise<string>;
  status(runId: string): Promise<string>;
}

export async function dispatchJob(
  job: AnalysisJob,
  repository: WorkflowRepository,
  runner: WorkflowRunner,
) {
  if (job.status !== "queued" || job.run_id) return job;
  const payload = { jobId: job.id, generation: job.generation };
  const runId = await runner.trigger(payload, `${job.id}:${job.generation}`);
  // Worker may have already advanced the row. Never overwrite it with queued.
  await repository.advance(payload, runId, "queued");
  return (await repository.get(payload)) ?? job;
}

export async function reconcileJob(
  job: AnalysisJob,
  repository: WorkflowRepository,
  runner: WorkflowRunner,
) {
  if (!isActiveJob(job)) return job;
  if (!job.run_id) return dispatchJob(job, repository, runner);
  const status = await runner.status(job.run_id);
  if (
    [
      "FAILED",
      "CRASHED",
      "SYSTEM_FAILURE",
      "EXPIRED",
      "TIMED_OUT",
      "CANCELED",
      "COMPLETED",
    ].includes(status)
  ) {
    // COMPLETED with a still-active DB row means the durable result was not persisted.
    const updated = await repository.advance(
      { jobId: job.id, generation: job.generation },
      job.run_id,
      status === "CANCELED" ? "cancelled" : "failed",
      job.attempt,
      status === "COMPLETED" ? "RESULT_NOT_PERSISTED" : "RUN_INTERRUPTED",
    );
    return (
      updated ??
      (await repository.get({ jobId: job.id, generation: job.generation })) ??
      job
    );
  }
  return job;
}

import type { JobPayload } from "@/features/analysis/job-contract";
import type { WorkflowRunner } from "./dispatch";

export interface WorkflowBinding {
  create(options: {
    id: string;
    params: JobPayload;
  }): Promise<{ id: string }>;
  get(id: string): Promise<{
    id: string;
    status(): Promise<{ status: string }>;
  }>;
}

function instanceId(key: string) {
  return `analysis-${key.replaceAll(":", "-")}`;
}

function runnerStatus(status: string) {
  switch (status) {
    case "complete":
      return "COMPLETED";
    case "errored":
      return "FAILED";
    case "terminated":
      return "CANCELED";
    case "queued":
    case "running":
    case "paused":
    case "waiting":
    case "waitingForPause":
      return "EXECUTING";
    default:
      return "FAILED";
  }
}

export function createCloudflareWorkflowRunner(
  workflow: WorkflowBinding,
): WorkflowRunner {
  return {
    async start(payload, key) {
      const id = instanceId(key);
      try {
        return (await workflow.create({ id, params: payload })).id;
      } catch (creationError) {
        try {
          return (await workflow.get(id)).id;
        } catch {
          throw creationError;
        }
      }
    },
    async status(runId) {
      if (!runId.startsWith("analysis-")) return "FAILED";
      const run = await workflow.get(runId);
      return runnerStatus((await run.status()).status);
    },
  };
}

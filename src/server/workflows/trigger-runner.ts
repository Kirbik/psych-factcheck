import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";
import { ANALYSIS_TASK_ID } from "@/features/analysis/job-contract";
import type { WorkflowRunner } from "./dispatch";

export const triggerRunner: WorkflowRunner = {
  async trigger(payload, key) {
    const idempotencyKey = await idempotencyKeys.create(key, {
      scope: "global",
    });
    const handle = await tasks.trigger(ANALYSIS_TASK_ID, payload, {
      idempotencyKey,
      idempotencyKeyTTL: "24h",
      ttl: "10m",
    });
    return handle.id;
  },
  async status(runId) {
    return (await runs.retrieve(runId)).status;
  },
};

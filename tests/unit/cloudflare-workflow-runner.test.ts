import { describe, expect, it, vi } from "vitest";
import {
  createCloudflareWorkflowRunner,
  type WorkflowBinding,
} from "@/server/workflows/cloudflare-runner";

const payload = {
  jobId: "33333333-3333-4333-8333-333333333333",
  generation: 2,
};

function workflowBinding() {
  return {
    create: vi.fn<WorkflowBinding["create"]>(),
    get: vi.fn<WorkflowBinding["get"]>(),
  } satisfies WorkflowBinding;
}

describe("Cloudflare Workflow runner", () => {
  it("uses a stable instance ID for the same job generation", async () => {
    const workflow = workflowBinding();
    workflow.create.mockResolvedValue({ id: "analysis-job-2" });
    const runner = createCloudflareWorkflowRunner(workflow);

    await expect(runner.start(payload, `${payload.jobId}:2`)).resolves.toBe(
      "analysis-job-2",
    );
    expect(workflow.create).toHaveBeenCalledExactlyOnceWith({
      id: `analysis-${payload.jobId}-2`,
      params: payload,
    });
  });

  it("recovers an ambiguous start by returning the deterministic instance", async () => {
    const workflow = workflowBinding();
    const failure = new Error("Workflow start response lost");
    workflow.create.mockRejectedValue(failure);
    workflow.get.mockResolvedValue({
      id: `analysis-${payload.jobId}-2`,
      status: async () => ({ status: "running" }),
    });
    const runner = createCloudflareWorkflowRunner(workflow);

    await expect(runner.start(payload, `${payload.jobId}:2`)).resolves.toBe(
      `analysis-${payload.jobId}-2`,
    );
    expect(workflow.get).toHaveBeenCalledExactlyOnceWith(
      `analysis-${payload.jobId}-2`,
    );
  });

  it.each([
    ["complete", "COMPLETED"],
    ["errored", "FAILED"],
    ["terminated", "CANCELED"],
    ["queued", "EXECUTING"],
    ["running", "EXECUTING"],
    ["waiting", "EXECUTING"],
    ["unknown", "FAILED"],
  ])("maps Cloudflare status %s to %s", async (status, expected) => {
    const workflow = workflowBinding();
    workflow.get.mockResolvedValue({
      id: "analysis-job-2",
      status: async () => ({ status }),
    });
    const runner = createCloudflareWorkflowRunner(workflow);

    await expect(runner.status("analysis-job-2")).resolves.toBe(expected);
  });

  it("recovers a legacy non-Cloudflare instance as failed for explicit retry", async () => {
    const workflow = workflowBinding();
    const runner = createCloudflareWorkflowRunner(workflow);

    await expect(runner.status("run_legacy-provider-123")).resolves.toBe(
      "FAILED",
    );
    expect(workflow.get).not.toHaveBeenCalled();
  });
});

import handler from "vinext/server/fetch-handler";
import {
  createCloudflareWorkflowRunner,
  type WorkflowBinding,
} from "@/server/workflows/cloudflare-runner";
import { reconcileJob } from "@/server/workflows/dispatch";
import { workflowRepository } from "@/server/workflows/repository";
import { createWorkerClient } from "./client";
export { AnalysisWorkflow } from "./analysis-workflow";

type WorkerExecutionContext = {
  passThroughOnException(): void;
  waitUntil(promise: Promise<unknown>): void;
};

type WorkerEnvironment = Record<string, unknown>;

const supabaseEnvironmentKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * Keep server-only modules compatible with Cloudflare bindings. Vinext reads
 * runtime configuration through process.env, while Workers expose bindings
 * through the fetch handler's environment argument.
 */
function populateSupabaseProcessEnv(environment: WorkerEnvironment) {
  for (const key of supabaseEnvironmentKeys) {
    const value = environment[key];
    if (typeof value === "string" && value.length > 0) {
      process.env[key] = value;
    }
  }
}

function withUtf8ContentType(response: Response) {
  const contentType = response.headers.get("content-type");
  if (
    !contentType?.startsWith("text/x-component") ||
    contentType.includes("charset=")
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", `${contentType}; charset=utf-8`);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

const worker = {
  async fetch(
    request: Request,
    environment: WorkerEnvironment,
    context: WorkerExecutionContext,
  ) {
    populateSupabaseProcessEnv(environment);
    const response = await handler.fetch(request, environment, context);
    return withUtf8ContentType(response);
  },

  scheduled(
    _controller: { cron: string; scheduledTime: number },
    environment: WorkerEnvironment,
    context: WorkerExecutionContext,
  ) {
    populateSupabaseProcessEnv(environment);
    context.waitUntil(reconcileActiveJobs(environment));
  },
};

async function reconcileActiveJobs(environment: WorkerEnvironment) {
  const repository = workflowRepository(createWorkerClient(environment));
  const workflow = environment.ANALYSIS_WORKFLOW;
  if (typeof workflow !== "object" || workflow === null)
    throw new Error("Cloudflare Workflow binding unavailable");
  const jobs = await repository.active();
  const runner = createCloudflareWorkflowRunner(workflow as WorkflowBinding);
  const results = await Promise.allSettled(
    jobs.map((job) => reconcileJob(job, repository, runner)),
  );
  if (results.some((result) => result.status === "rejected"))
    throw new Error("Job reconciliation incomplete");
}

export default worker;

import "server-only";
import { env } from "cloudflare:workers";
import { createAdminSupabaseClient } from "@/server/supabase/admin";
import { workflowRepository } from "./repository";
import {
  createCloudflareWorkflowRunner,
  type WorkflowBinding,
} from "./cloudflare-runner";

function analysisWorkflowBinding(): WorkflowBinding | undefined {
  const binding = env.ANALYSIS_WORKFLOW;
  if (
    typeof binding !== "object" ||
    binding === null ||
    !("create" in binding) ||
    typeof binding.create !== "function" ||
    !("get" in binding) ||
    typeof binding.get !== "function"
  ) {
    return undefined;
  }
  return binding as WorkflowBinding;
}

export function workflowRunner() {
  const binding = analysisWorkflowBinding();
  if (!binding) return undefined;
  return createCloudflareWorkflowRunner(binding);
}

export function operationalRepository() {
  // Privileged only after the route has verified ownership with the user's RLS client.
  return workflowRepository(createAdminSupabaseClient());
}

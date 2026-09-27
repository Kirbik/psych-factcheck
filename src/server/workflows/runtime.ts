import "server-only";
import { createAdminSupabaseClient } from "@/server/supabase/admin";
import { workflowRepository } from "./repository";

export function workflowConfigured() {
  return Boolean(process.env.TRIGGER_SECRET_KEY?.trim());
}
export function operationalRepository() {
  // Privileged only after the route has verified ownership with the user's RLS client.
  return workflowRepository(createAdminSupabaseClient());
}

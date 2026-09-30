import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  PIPELINE_VERSION,
  type JobPayload,
} from "@/features/analysis/job-contract";
import type { TranscriptionResult } from "@/server/ai/providers";

export type AnalysisJob = Database["public"]["Tables"]["analysis_jobs"]["Row"];
export type WorkflowClient = SupabaseClient<Database>;

// Used by both the Next server and the standalone Trigger worker. No browser imports.
export function workflowRepository(client: WorkflowClient) {
  return {
    async findOwned(contentId: string, userId: string) {
      const { data, error } = await client
        .from("analysis_jobs")
        .select()
        .eq("content_item_id", contentId)
        .eq("user_id", userId)
        .eq("pipeline_version", PIPELINE_VERSION)
        .maybeSingle();
      if (error) throw new Error("Job read failed");
      return data;
    },
    async request(contentId: string, retryGeneration?: number) {
      const { data, error } = await client.rpc("request_analysis_job", {
        p_content_item_id: contentId,
        p_retry_generation: retryGeneration,
      });
      if (error || !data) throw new Error("Job request failed");
      return data;
    },
    async get(payload: JobPayload) {
      const { data, error } = await client
        .from("analysis_jobs")
        .select()
        .eq("id", payload.jobId)
        .eq("generation", payload.generation)
        .eq("pipeline_version", PIPELINE_VERSION)
        .maybeSingle();
      if (error) throw new Error("Job read failed");
      return data;
    },
    async advance(
      payload: JobPayload,
      runId: string,
      status: AnalysisJob["status"],
      attempt = 0,
      errorCode?: string,
    ): Promise<AnalysisJob | null> {
      const { data, error } = await client.rpc("advance_analysis_job", {
        p_job_id: payload.jobId,
        p_generation: payload.generation,
        p_run_id: runId,
        p_status: status,
        p_attempt: attempt,
        p_error_code: errorCode,
      });
      if (error) throw new Error("Job transition failed");
      return data?.[0] ?? null;
    },
    async setStage(
      payload: JobPayload,
      runId: string,
      stage: string,
      attempt: number,
    ) {
      const { data, error } = await client.rpc("set_analysis_job_stage", {
        p_job_id: payload.jobId,
        p_generation: payload.generation,
        p_run_id: runId,
        p_stage: stage,
        p_attempt: attempt,
      });
      if (error) throw new Error("Job stage update failed");
      return data === true;
    },
    async hasTranscript(contentItemId: string) {
      const { data, error } = await client
        .from("transcripts")
        .select("id")
        .eq("content_item_id", contentItemId)
        .eq("pipeline_version", PIPELINE_VERSION)
        .maybeSingle();
      if (error) throw new Error("Transcript read failed");
      return Boolean(data);
    },
    async saveTranscript(
      contentItemId: string,
      provider: string,
      model: string,
      result: TranscriptionResult,
    ) {
      const { error } = await client.from("transcripts").upsert(
        {
          content_item_id: contentItemId,
          pipeline_version: PIPELINE_VERSION,
          provider,
          model,
          language: result.language,
          segments: result.segments.map((segment) => ({ ...segment })),
        },
        {
          onConflict: "content_item_id,pipeline_version",
          ignoreDuplicates: true,
        },
      );
      if (error) throw new Error("Transcript write failed");
    },
    async content(job: AnalysisJob) {
      const { data, error } = await client
        .from("content_items")
        .select()
        .eq("id", job.content_item_id)
        .eq("user_id", job.user_id)
        .maybeSingle();
      if (error) throw new Error("Content read failed");
      return data;
    },
    async active() {
      const { data, error } = await client
        .from("analysis_jobs")
        .select()
        .eq("pipeline_version", PIPELINE_VERSION)
        .in("status", ["queued", "running"])
        .order("updated_at", { ascending: true })
        .limit(100);
      if (error) throw new Error("Active jobs read failed");
      return data;
    },
  };
}
export type WorkflowRepository = ReturnType<typeof workflowRepository>;

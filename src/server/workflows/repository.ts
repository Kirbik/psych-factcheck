import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  PIPELINE_VERSION,
  TRANSCRIPTION_VERSION,
  type JobPayload,
} from "@/features/analysis/job-contract";
import type {
  ClaimExtractionResult,
  TranscriptionResult,
} from "@/server/ai/providers";
import {
  CLAIM_EXTRACTION_VERSION,
  claimTypeSchema,
  transcriptSegmentsSchema,
} from "@/server/ai/claim-extraction";
import type { EvidencePackage, ExtractedClaim } from "@/server/ai/providers";
import { EVIDENCE_RERANKING_VERSION } from "@/server/evidence/reranking";
import { EVIDENCE_RETRIEVAL_VERSION } from "@/server/evidence/search";
import {
  FACT_CHECK_JUDGMENT_VERSION,
  validateEvidencePackage,
} from "@/server/ai/judgment";
import type { Json } from "@/types/database";
import { z } from "zod";
import {
  SCREENING_VERSION,
  videoScreeningSchema,
  type VideoScreening,
} from "@/server/ai/video-screening";

export type AnalysisJob = Database["public"]["Tables"]["analysis_jobs"]["Row"];
export type WorkflowClient = SupabaseClient<Database>;

const persistedClaimSchema = z
  .object({
    id: z.uuid(),
    original_text: z.string().min(1).max(1_200),
    normalized_text: z.string().min(1).max(1_200),
    start_seconds: z.number().finite().nonnegative(),
    end_seconds: z.number().finite().nonnegative(),
    claim_type: claimTypeSchema,
  })
  .strict();

export function workflowDatabaseFailure(operation: string, code?: string) {
  const safeCode = code && /^[a-z0-9_-]{1,32}$/i.test(code) ? code : null;
  return new Error(
    safeCode
      ? `${operation} failed (Supabase error code ${safeCode})`
      : `${operation} failed (Supabase error code unavailable)`,
  );
}

export interface PersistedClaim {
  readonly id: string;
  readonly claim: ExtractedClaim;
}

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
      if (error) throw workflowDatabaseFailure("Job read", error.code);
      return data;
    },
    async request(contentId: string, retryGeneration?: number) {
      const { data, error } = await client.rpc("request_analysis_job", {
        p_content_item_id: contentId,
        p_retry_generation: retryGeneration,
      });
      if (error) throw workflowDatabaseFailure("Job request", error.code);
      if (!data)
        throw new Error("Job request failed (Supabase returned no row)");
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
      if (error) throw workflowDatabaseFailure("Job read", error.code);
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
      if (error) throw workflowDatabaseFailure("Job transition", error.code);
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
      if (error) throw workflowDatabaseFailure("Job stage update", error.code);
      return data === true;
    },
    async hasTranscript(contentItemId: string) {
      const { data, error } = await client
        .from("transcripts")
        .select("id")
        .eq("content_item_id", contentItemId)
        .eq("pipeline_version", TRANSCRIPTION_VERSION)
        .maybeSingle();
      if (error) throw workflowDatabaseFailure("Transcript read", error.code);
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
          pipeline_version: TRANSCRIPTION_VERSION,
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
      if (error) throw workflowDatabaseFailure("Transcript write", error.code);
    },
    async getTranscript(
      contentItemId: string,
    ): Promise<{ id: string; result: TranscriptionResult } | null> {
      const { data, error } = await client
        .from("transcripts")
        .select("id, language, segments")
        .eq("content_item_id", contentItemId)
        .eq("pipeline_version", TRANSCRIPTION_VERSION)
        .maybeSingle();
      if (error) throw workflowDatabaseFailure("Transcript read", error.code);
      if (!data) return null;
      const segments = transcriptSegmentsSchema.safeParse(data.segments);
      if (!segments.success) throw new Error("Transcript record invalid");
      return {
        id: data.id,
        result: { language: data.language, segments: segments.data },
      };
    },
    async hasClaimExtraction(transcriptId: string) {
      const { data, error } = await client
        .from("claim_extractions")
        .select("id")
        .eq("transcript_id", transcriptId)
        .eq("extraction_version", CLAIM_EXTRACTION_VERSION)
        .maybeSingle();
      if (error)
        throw workflowDatabaseFailure("Claim extraction read", error.code);
      return Boolean(data);
    },
    async saveClaimExtraction(
      transcriptId: string,
      result: ClaimExtractionResult,
    ) {
      const { data, error } = await client.rpc("save_claim_extraction", {
        p_transcript_id: transcriptId,
        p_extraction_version: result.extractionVersion,
        p_provider: result.provider,
        p_model: result.model,
        p_instructions_version: result.instructionsVersion,
        p_schema_version: result.schemaVersion,
        p_claims: result.claims.map((claim) => ({
          original: claim.original,
          normalized: claim.normalized,
          startSeconds: claim.startSeconds,
          endSeconds: claim.endSeconds,
          claimType: claim.claimType,
        })),
      });
      if (error)
        throw workflowDatabaseFailure("Claim extraction write", error.code);
      if (!data)
        throw new Error(
          "Claim extraction write failed (Supabase returned no row)",
        );
    },
    async getClaimExtractionId(transcriptId: string) {
      const { data, error } = await client
        .from("claim_extractions")
        .select("id")
        .eq("transcript_id", transcriptId)
        .eq("extraction_version", CLAIM_EXTRACTION_VERSION)
        .maybeSingle();
      if (error)
        throw workflowDatabaseFailure("Claim extraction read", error.code);
      return data?.id ?? null;
    },
    async listClaims(extractionId: string): Promise<readonly PersistedClaim[]> {
      const { data, error } = await client
        .from("claims")
        .select(
          "id, original_text, normalized_text, start_seconds, end_seconds, claim_type",
        )
        .eq("claim_extraction_id", extractionId)
        .order("ordinal", { ascending: true });
      if (error) throw workflowDatabaseFailure("Claims read", error.code);
      const parsed = z.array(persistedClaimSchema).safeParse(data);
      if (!parsed.success) throw new Error("Claim records invalid");
      return parsed.data.map((claim) => ({
        id: claim.id,
        claim: {
          original: claim.original_text,
          normalized: claim.normalized_text,
          startSeconds: claim.start_seconds,
          endSeconds: claim.end_seconds,
          claimType: claim.claim_type,
        },
      }));
    },
    async existingEvidencePackageClaimIds(claimIds: readonly string[]) {
      if (claimIds.length === 0) return new Set<string>();
      const { data, error } = await client
        .from("evidence_packages")
        .select("claim_id")
        .in("claim_id", [...claimIds])
        .eq("retrieval_version", EVIDENCE_RETRIEVAL_VERSION)
        .eq("reranking_version", EVIDENCE_RERANKING_VERSION);
      if (error)
        throw workflowDatabaseFailure("Evidence package read", error.code);
      return new Set(data.map(({ claim_id }) => claim_id));
    },
    async saveEvidencePackages(
      extractionId: string,
      packages: readonly {
        readonly claimId: string;
        readonly package: EvidencePackage;
      }[],
    ) {
      if (packages.length === 0) return;
      const payload = packages.map(({ claimId, package: evidencePackage }) => ({
        claimId,
        retrievalVersion: evidencePackage.retrievalVersion,
        rerankingVersion: evidencePackage.rerankingVersion,
        coverage: evidencePackage.coverage,
        payload: evidencePackage,
      }));
      const { error } = await client.rpc("save_evidence_packages", {
        p_claim_extraction_id: extractionId,
        p_retrieval_version: EVIDENCE_RETRIEVAL_VERSION,
        p_reranking_version: EVIDENCE_RERANKING_VERSION,
        p_packages: payload as unknown as Json,
      });
      if (error)
        throw workflowDatabaseFailure("Evidence packages write", error.code);
    },
    async listEvidencePackages(claimIds: readonly string[]) {
      if (claimIds.length === 0) return [];
      const { data, error } = await client
        .from("evidence_packages")
        .select("id, claim_id, payload")
        .in("claim_id", [...claimIds])
        .eq("retrieval_version", EVIDENCE_RETRIEVAL_VERSION)
        .eq("reranking_version", EVIDENCE_RERANKING_VERSION);
      if (error)
        throw workflowDatabaseFailure("Evidence package read", error.code);
      return data.map(({ id, claim_id, payload }) => {
        const evidencePackage = validateEvidencePackage(payload);
        return {
          evidencePackageId: id,
          claimId: claim_id,
          packageClaim: evidencePackage.claim,
        };
      });
    },
    async existingFactCheckPairs(
      pairs: readonly {
        readonly claimId: string;
        readonly evidencePackageId: string;
      }[],
    ) {
      if (pairs.length === 0) return [];
      const { data, error } = await client
        .from("fact_checks")
        .select("claim_id, evidence_package_id")
        .in(
          "claim_id",
          pairs.map(({ claimId }) => claimId),
        )
        .in(
          "evidence_package_id",
          pairs.map(({ evidencePackageId }) => evidencePackageId),
        )
        .eq("judgment_version", FACT_CHECK_JUDGMENT_VERSION);
      if (error) throw workflowDatabaseFailure("Fact-check read", error.code);
      const requestedPairs = new Set(
        pairs.map(({ claimId, evidencePackageId }) =>
          JSON.stringify([claimId, evidencePackageId]),
        ),
      );
      return data
        .filter(({ claim_id, evidence_package_id }) =>
          requestedPairs.has(JSON.stringify([claim_id, evidence_package_id])),
        )
        .map(({ claim_id, evidence_package_id }) => ({
          claimId: claim_id,
          evidencePackageId: evidence_package_id,
        }));
    },
    async getScreening(contentItemId: string): Promise<VideoScreening | null> {
      const { data, error } = await client
        .from("video_screenings")
        .select()
        .eq("content_item_id", contentItemId)
        .eq("screening_version", SCREENING_VERSION)
        .maybeSingle();
      if (error)
        throw workflowDatabaseFailure("Video screening read", error.code);
      if (!data) return null;
      const result = videoScreeningSchema.safeParse({
        decision: data.decision,
        reasonCode: data.reason_code,
        confidence: data.confidence,
        rationale: data.rationale,
        sampleDurationSeconds: data.sample_duration_seconds,
        provider: data.provider,
        sampleModel: data.sample_model,
        classifierModel: data.classifier_model,
        instructionsVersion: data.instructions_version,
      });
      if (!result.success) throw new Error("Video screening record invalid");
      return result.data;
    },
    async saveScreening(
      contentItemId: string,
      result: VideoScreening,
    ): Promise<VideoScreening> {
      const { error } = await client.from("video_screenings").upsert(
        {
          content_item_id: contentItemId,
          screening_version: SCREENING_VERSION,
          provider: result.provider,
          sample_model: result.sampleModel,
          classifier_model: result.classifierModel,
          instructions_version: result.instructionsVersion,
          decision: result.decision,
          reason_code: result.reasonCode,
          confidence: result.confidence,
          rationale: result.rationale,
          sample_duration_seconds: result.sampleDurationSeconds,
        },
        {
          onConflict: "content_item_id,screening_version",
          ignoreDuplicates: true,
        },
      );
      if (error)
        throw workflowDatabaseFailure("Video screening write", error.code);
      const saved = await this.getScreening(contentItemId);
      if (!saved) throw new Error("Video screening write missing");
      return saved;
    },
    async content(job: AnalysisJob) {
      const { data, error } = await client
        .from("content_items")
        .select()
        .eq("id", job.content_item_id)
        .eq("user_id", job.user_id)
        .maybeSingle();
      if (error) throw workflowDatabaseFailure("Content read", error.code);
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
      if (error) throw workflowDatabaseFailure("Active jobs read", error.code);
      return data;
    },
  };
}
export type WorkflowRepository = ReturnType<typeof workflowRepository>;

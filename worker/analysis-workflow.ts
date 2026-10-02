import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  jobPayloadSchema,
  type JobPayload,
} from "@/features/analysis/job-contract";
import {
  executeClaimExtractionStage,
  executeEvidencePackageStage,
  executeJudgmentStage,
  executeScreeningStage,
  executeTranscriptionStage,
  PermanentWorkflowError,
} from "@/server/workflows/execute";
import { workflowRepository } from "@/server/workflows/repository";
import { VIDEO_BUCKET } from "@/server/storage/video-validator";
import {
  createOpenAITranscriptionProvider,
  MAX_OPENAI_TRANSCRIPTION_BYTES,
  TranscriptionProviderError,
} from "@/server/ai/openai-transcription-provider";
import {
  createOpenAIVideoScreeningProvider,
  uncertainScreening,
} from "@/server/ai/openai-video-screening-provider";
import {
  createOpenAIClaimExtractionProvider,
  ClaimExtractionProviderError,
} from "@/server/ai/openai-claim-extraction-provider";
import {
  createOpenAIEmbeddingProvider,
  EmbeddingProviderError,
} from "@/server/ai/openai-embedding-provider";
import { EvidenceSearchError } from "@/server/evidence/search";
import { searchEvidenceBatch } from "@/server/evidence/search";
import { EvidenceRerankingError } from "@/server/evidence/reranking";
import { readWorkflowVideoHeader } from "@/server/workflows/video-header";
import { readWorkflowVideo } from "@/server/workflows/video-download";
import {
  createOpenAIJudgmentProvider,
  JudgmentProviderError,
} from "@/server/ai/openai-judgment-provider";
import { createFactCheckService } from "@/server/ai/fact-check-service";
import { factCheckRepository } from "@/server/ai/fact-check-repository";
import { createWorkerClient } from "./client";

export class AnalysisWorkflow extends WorkflowEntrypoint<
  Record<string, unknown>,
  JobPayload
> {
  async run(event: WorkflowEvent<JobPayload>, step: WorkflowStep) {
    const payload = jobPayloadSchema.parse(event.payload);
    const client = createWorkerClient(this.env);
    const repository = workflowRepository(client);
    const apiKey =
      typeof this.env.OPENAI_API_KEY === "string"
        ? this.env.OPENAI_API_KEY
        : undefined;
    const transcriptionProvider = createOpenAITranscriptionProvider(apiKey);
    const screeningProvider = createOpenAIVideoScreeningProvider(apiKey);
    const claimExtractionProvider = createOpenAIClaimExtractionProvider(apiKey);
    const embeddingProvider = createOpenAIEmbeddingProvider(apiKey);
    const judgmentProvider = createOpenAIJudgmentProvider(apiKey);
    const factCheckService = createFactCheckService(
      factCheckRepository(client),
      judgmentProvider,
    );
    let attempt = 1;
    let activeStage = "screen_video";
    let failureCode: string | undefined;

    const inspectVideo = async (path: string) => {
      const client = createWorkerClient(this.env);
      const { data, error } = await client.storage
        .from(VIDEO_BUCKET)
        .info(path);
      if (error || !data) {
        if (
          error &&
          "statusCode" in error &&
          String(error.statusCode) === "404"
        )
          throw new PermanentWorkflowError("UPLOAD_MISSING");
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
    };

    const downloadVideo = async (storagePath: string, ttlSeconds: number) => {
      const client = createWorkerClient(this.env);
      const signed = await client.storage
        .from(VIDEO_BUCKET)
        .createSignedUrl(storagePath, ttlSeconds);
      if (signed.error || !signed.data)
        throw new Error("Video download unavailable");
      return readWorkflowVideo(
        signed.data.signedUrl,
        MAX_OPENAI_TRANSCRIPTION_BYTES,
      );
    };

    try {
      const screening = await step.do(
        "screen uploaded video topic",
        {
          retries: {
            limit: 2,
            delay: "1 second",
            backoff: "exponential",
          },
          timeout: "4 minutes",
        },
        async (context) => {
          attempt = context.attempt;
          try {
            return await executeScreeningStage(
              payload,
              event.instanceId,
              context.attempt,
              repository,
              inspectVideo,
              async (input) => {
                const bytes = await downloadVideo(input.storagePath, 180);
                if (
                  input.contentType !== "video/mp4" &&
                  input.contentType !== "video/webm"
                ) {
                  return uncertainScreening("sample_unavailable");
                }
                return screeningProvider.screen({
                  bytes,
                  contentType: input.contentType,
                });
              },
            );
          } catch (error) {
            if (error instanceof PermanentWorkflowError) {
              failureCode = error.message;
              throw new NonRetryableError(error.message);
            }
            throw error;
          }
        },
      );
      if (
        screening.outcome === "obsolete" ||
        screening.outcome === "screened_out"
      )
        return screening;

      if (screening.outcome === "ready_for_transcription") {
        activeStage = "transcribe_video";
        const transcription = await step.do(
          "transcribe screened video",
          {
            retries: {
              limit: 2,
              delay: "1 second",
              backoff: "exponential",
            },
            timeout: "4 minutes",
          },
          async (context) => {
            attempt = context.attempt;
            try {
              return await executeTranscriptionStage(
                payload,
                event.instanceId,
                context.attempt,
                repository,
                inspectVideo,
                async (input) => {
                  try {
                    const bytes = await downloadVideo(input.storagePath, 300);
                    return await transcriptionProvider.transcribe({
                      fileName: input.fileName,
                      contentType: input.contentType,
                      bytes,
                    });
                  } catch (error) {
                    if (error instanceof TranscriptionProviderError) {
                      failureCode = error.code;
                      if (!error.retryable)
                        throw new NonRetryableError(error.code);
                      throw error;
                    }
                    throw error;
                  }
                },
              );
            } catch (error) {
              if (error instanceof PermanentWorkflowError) {
                failureCode = error.message;
                throw new NonRetryableError(error.message);
              }
              throw error;
            }
          },
        );
        if (transcription.outcome !== "ready_for_claim_extraction")
          return transcription;
      }

      activeStage = "extract_claims";
      const claimExtraction = await step.do(
        "extract claims from transcript",
        {
          retries: {
            limit: 2,
            delay: "1 second",
            backoff: "exponential",
          },
          timeout: "4 minutes",
        },
        async (context) => {
          attempt = context.attempt;
          try {
            return await executeClaimExtractionStage(
              payload,
              event.instanceId,
              context.attempt,
              repository,
              claimExtractionProvider,
            );
          } catch (error) {
            if (error instanceof ClaimExtractionProviderError) {
              failureCode = error.code;
              if (error.code === "CLAIM_OUTPUT_INVALID") {
                console.error("[analysis] Claim extraction output rejected", {
                  jobId: payload.jobId,
                  validationIssue: error.validationIssue,
                });
              }
              if (!error.retryable) throw new NonRetryableError(error.code);
              throw error;
            }
            if (error instanceof PermanentWorkflowError) {
              failureCode = error.message;
              throw new NonRetryableError(error.message);
            }
            throw error;
          }
        },
      );
      if (claimExtraction.outcome !== "ready_for_evidence_packages")
        return claimExtraction;

      activeStage = "build_evidence";
      const evidence = await step.do(
        "retrieve and package claim evidence",
        {
          retries: {
            limit: 2,
            delay: "1 second",
            backoff: "exponential",
          },
          timeout: "4 minutes",
        },
        async (context) => {
          attempt = context.attempt;
          try {
            return await executeEvidencePackageStage(
              payload,
              event.instanceId,
              context.attempt,
              repository,
              (claims) =>
                searchEvidenceBatch(client, embeddingProvider, claims),
            );
          } catch (error) {
            if (error instanceof EmbeddingProviderError) {
              failureCode = error.code;
              if (!error.retryable) throw new NonRetryableError(error.code);
              throw error;
            }
            if (error instanceof EvidenceSearchError) {
              failureCode = error.code;
              if (
                error.code === "EVIDENCE_SEARCH_INPUT_INVALID" ||
                error.code === "EMBEDDING_MODEL_VERSION_UNSUPPORTED" ||
                error.code === "EMBEDDING_DIMENSION_MISMATCH" ||
                error.code === "EMBEDDING_RESPONSE_INVALID" ||
                error.code === "EVIDENCE_SEARCH_RESPONSE_INVALID"
              ) {
                throw new NonRetryableError(error.code);
              }
              throw error;
            }
            if (error instanceof EvidenceRerankingError) {
              failureCode = error.code;
              throw new NonRetryableError(error.code);
            }
            if (error instanceof PermanentWorkflowError) {
              failureCode = error.message;
              throw new NonRetryableError(error.message);
            }
            throw error;
          }
        },
      );
      if (evidence.outcome !== "ready_for_fact_checks") return evidence;

      activeStage = "judge_claims";
      return await executeJudgmentStage(
        payload,
        event.instanceId,
        attempt,
        repository,
        async ({ claimId, evidencePackageId }) =>
          step.do(
            `judge claim ${claimId}`,
            {
              retries: {
                limit: 2,
                delay: "1 second",
                backoff: "exponential",
              },
              timeout: "4 minutes",
            },
            async (context) => {
              attempt = context.attempt;
              const active = await repository.setStage(
                payload,
                event.instanceId,
                "judge_claims",
                context.attempt,
              );
              if (!active) {
                failureCode = "RUN_OBSOLETE";
                throw new NonRetryableError("RUN_OBSOLETE");
              }
              try {
                return await factCheckService.judgeAndSave({
                  claimId,
                  evidencePackageId,
                  jobId: payload.jobId,
                  generation: payload.generation,
                  runId: event.instanceId,
                });
              } catch (error) {
                if (error instanceof JudgmentProviderError) {
                  failureCode = error.code;
                  if (!error.retryable) throw new NonRetryableError(error.code);
                }
                throw error;
              }
            },
          ),
        (operation) =>
          step.do(
            "prepare claims for judgment",
            {
              retries: {
                limit: 2,
                delay: "1 second",
                backoff: "exponential",
              },
              timeout: "4 minutes",
            },
            operation,
          ),
      );
    } catch (error) {
      const errorCode =
        failureCode ??
        (error instanceof NonRetryableError ||
        error instanceof PermanentWorkflowError
          ? error.message
          : "WORKFLOW_FAILED");
      const errorSummary = {
        jobId: payload.jobId,
        generation: payload.generation,
        stage: activeStage,
        attempt,
        errorCode,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error
            ? error.message.slice(0, 160)
            : "Non-Error thrown",
      };

      try {
        await step.do(
          "persist failed analysis job",
          {
            retries: {
              limit: 2,
              delay: "1 second",
              backoff: "exponential",
            },
            timeout: "1 minute",
          },
          async () => {
            const updated = await repository.advance(
              payload,
              event.instanceId,
              "failed",
              attempt,
              errorCode,
            );
            if (updated) return;

            const current = await repository.get(payload);
            if (
              current?.run_id !== event.instanceId ||
              current.status !== "failed"
            ) {
              throw new Error("Failure state transition was rejected");
            }
          },
        );
      } catch (persistenceError) {
        console.error("[analysis] Failed to persist workflow failure", {
          ...errorSummary,
          persistenceErrorName:
            persistenceError instanceof Error
              ? persistenceError.name
              : "UnknownError",
          persistenceErrorMessage:
            persistenceError instanceof Error
              ? persistenceError.message.slice(0, 160)
              : "Non-Error thrown",
        });
      }

      console.error("[analysis] Workflow failed", errorSummary);
      throw error;
    }
  }
}

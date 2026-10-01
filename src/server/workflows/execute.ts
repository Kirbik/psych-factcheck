import { isOwnedGeneratedVideoPath } from "@/server/storage/video-upload-path";
import {
  validateVideoBytes,
  validateVideoMetadata,
  VideoValidationError,
} from "@/server/storage/video-validator";
import type { JobPayload } from "@/features/analysis/job-contract";
import type {
  ClaimExtractionProvider,
  TranscriptionResult,
} from "@/server/ai/providers";
import { buildEvidencePackage } from "@/server/evidence/reranking";
import type { EvidenceSearchResult } from "@/server/evidence/search";
import { MAX_OPENAI_TRANSCRIPTION_BYTES } from "@/server/ai/openai-transcription-provider";
import { FactCheckJudgmentError } from "@/server/ai/judgment";
import {
  SCREENING_REJECTION_CONFIDENCE,
  type VideoScreening,
} from "@/server/ai/video-screening";
import { uncertainScreening } from "@/server/ai/openai-video-screening-provider";
import type { WorkflowRepository } from "./repository";

export class PermanentWorkflowError extends Error {}

type VideoInspection = { size: number; header: Uint8Array };
type ScreenInput = {
  storagePath: string;
  fileName: string;
  contentType: string;
  size: number;
};

function sameExtractedClaim(
  left: {
    readonly original: string;
    readonly normalized: string;
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly claimType: string;
  },
  right: {
    readonly original: string;
    readonly normalized: string;
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly claimType: string;
  },
) {
  return (
    left.original === right.original &&
    left.normalized === right.normalized &&
    left.startSeconds === right.startSeconds &&
    left.endSeconds === right.endSeconds &&
    left.claimType === right.claimType
  );
}

async function inspectOwnedUpload(
  payload: JobPayload,
  runId: string,
  attempt: number,
  repository: WorkflowRepository,
  inspectVideo: (path: string) => Promise<VideoInspection>,
) {
  const job = await repository.advance(payload, runId, "running", attempt);
  if (!job) return null;
  const content = await repository.content(job);
  if (
    !content?.storage_path ||
    !content.original_file_name ||
    !isOwnedGeneratedVideoPath(content.storage_path, job.user_id)
  ) {
    throw new PermanentWorkflowError("INVALID_UPLOAD");
  }
  const actual = await inspectVideo(content.storage_path);
  if (actual.size > MAX_OPENAI_TRANSCRIPTION_BYTES)
    throw new PermanentWorkflowError("TRANSCRIPTION_FILE_TOO_LARGE");
  try {
    const metadata = validateVideoMetadata(
      content.original_file_name,
      actual.size,
    );
    validateVideoBytes(actual.header, metadata.extension);
    if (!content.storage_path.endsWith(metadata.extension))
      throw new PermanentWorkflowError("INVALID_UPLOAD");
    if (
      metadata.fileSizeBytes !== content.file_size_bytes ||
      metadata.fileMimeType !== content.file_mime_type
    ) {
      throw new PermanentWorkflowError("UPLOAD_CHANGED");
    }
  } catch (error) {
    if (error instanceof VideoValidationError)
      throw new PermanentWorkflowError("INVALID_UPLOAD");
    throw error;
  }
  return { job, content, actual };
}

function isClearlyOutOfScope(screening: VideoScreening) {
  return (
    screening.decision === "unrelated" &&
    screening.confidence >= SCREENING_REJECTION_CONFIDENCE &&
    [
      "no_psychology_content",
      "incidental_mention",
      "no_checkable_claims",
    ].includes(screening.reasonCode)
  );
}

export async function executeScreeningStage(
  payload: JobPayload,
  runId: string,
  attempt: number,
  repository: WorkflowRepository,
  inspectVideo: (path: string) => Promise<VideoInspection>,
  screenVideo: (input: ScreenInput) => Promise<VideoScreening>,
) {
  const inspected = await inspectOwnedUpload(
    payload,
    runId,
    attempt,
    repository,
    inspectVideo,
  );
  if (!inspected) return { outcome: "obsolete" } as const;
  const { job, content, actual } = inspected;
  if (await repository.hasTranscript(job.content_item_id)) {
    return { outcome: "ready_for_claim_extraction" } as const;
  }
  if (!(await repository.setStage(payload, runId, "screen_video", attempt)))
    return { outcome: "obsolete" } as const;

  let screening: VideoScreening | null;
  try {
    screening = await repository.getScreening(job.content_item_id);
  } catch {
    // Failure to read screening metadata must not block the original workflow.
    screening = uncertainScreening("provider_error");
  }
  if (!screening) {
    try {
      screening = await screenVideo({
        storagePath: content.storage_path!,
        fileName: content.original_file_name!,
        contentType: content.file_mime_type!,
        size: actual.size,
      });
    } catch {
      // Screening is a cost-saving filter only. A failed screening never blocks transcription.
      screening = uncertainScreening("provider_error");
    }
    try {
      screening = await repository.saveScreening(
        job.content_item_id,
        screening,
      );
    } catch {
      // If diagnostic persistence is temporarily unavailable, fail open.
      screening = uncertainScreening("provider_error");
    }
  }

  if (isClearlyOutOfScope(screening)) {
    const completed = await repository.advance(
      payload,
      runId,
      "completed",
      attempt,
      "VIDEO_OUT_OF_SCOPE",
    );
    return { outcome: completed ? "screened_out" : "obsolete" } as const;
  }
  return { outcome: "ready_for_transcription" } as const;
}

export async function executeTranscriptionStage(
  payload: JobPayload,
  runId: string,
  attempt: number,
  repository: WorkflowRepository,
  inspectVideo: (path: string) => Promise<VideoInspection>,
  transcribeVideo: (input: ScreenInput) => Promise<TranscriptionResult>,
) {
  const inspected = await inspectOwnedUpload(
    payload,
    runId,
    attempt,
    repository,
    inspectVideo,
  );
  if (!inspected) return { outcome: "obsolete" } as const;
  const { job, content, actual } = inspected;
  if (!(await repository.setStage(payload, runId, "transcribe_video", attempt)))
    return { outcome: "obsolete" } as const;

  if (!(await repository.hasTranscript(job.content_item_id))) {
    const transcript = await transcribeVideo({
      storagePath: content.storage_path!,
      fileName: content.original_file_name!,
      contentType: content.file_mime_type!,
      size: actual.size,
    });
    await repository.saveTranscript(
      job.content_item_id,
      "openai",
      "whisper-1",
      transcript,
    );
  }
  return { outcome: "ready_for_claim_extraction" } as const;
}

export async function executeClaimExtractionStage(
  payload: JobPayload,
  runId: string,
  attempt: number,
  repository: WorkflowRepository,
  claimExtractor: ClaimExtractionProvider,
) {
  const job = await repository.advance(payload, runId, "running", attempt);
  if (!job) return { outcome: "obsolete" } as const;
  const transcript = await repository.getTranscript(job.content_item_id);
  if (!transcript) throw new PermanentWorkflowError("TRANSCRIPT_MISSING");
  if (!(await repository.setStage(payload, runId, "extract_claims", attempt)))
    return { outcome: "obsolete" } as const;

  if (!(await repository.hasClaimExtraction(transcript.id))) {
    const result = await claimExtractor.extractClaims(
      transcript.result.segments,
    );
    await repository.saveClaimExtraction(transcript.id, result);
  }
  return { outcome: "ready_for_evidence_packages" } as const;
}

export async function executeEvidencePackageStage(
  payload: JobPayload,
  runId: string,
  attempt: number,
  repository: WorkflowRepository,
  retrieveEvidence: (
    normalizedClaims: readonly string[],
  ) => Promise<readonly EvidenceSearchResult[]>,
) {
  const job = await repository.advance(payload, runId, "running", attempt);
  if (!job) return { outcome: "obsolete" } as const;
  const transcript = await repository.getTranscript(job.content_item_id);
  if (!transcript) throw new PermanentWorkflowError("TRANSCRIPT_MISSING");
  const extractionId = await repository.getClaimExtractionId(transcript.id);
  if (!extractionId)
    throw new PermanentWorkflowError("CLAIM_EXTRACTION_MISSING");
  if (!(await repository.setStage(payload, runId, "build_evidence", attempt)))
    return { outcome: "obsolete" } as const;

  const claims = await repository.listClaims(extractionId);
  const existingPackages = await repository.existingEvidencePackageClaimIds(
    claims.map(({ id }) => id),
  );
  const pendingClaims = claims.filter(({ id }) => !existingPackages.has(id));
  if (pendingClaims.length > 0) {
    const retrievalResults = await retrieveEvidence(
      pendingClaims.map(({ claim }) => claim.normalized),
    );
    const packages = await Promise.all(
      pendingClaims.map(async (item, index) => {
        const retrieval = retrievalResults[index];
        if (!retrieval) throw new Error("Evidence search result missing");
        return {
          claimId: item.id,
          package: await buildEvidencePackage(item.claim, retrieval),
        };
      }),
    );
    await repository.saveEvidencePackages(extractionId, packages);
  }

  const stillCurrent = await repository.setStage(
    payload,
    runId,
    "build_evidence",
    attempt,
  );
  return {
    outcome: stillCurrent ? "ready_for_fact_checks" : "obsolete",
  } as const;
}

export async function executeJudgmentStage(
  payload: JobPayload,
  runId: string,
  attempt: number,
  repository: WorkflowRepository,
  judgeClaim: (input: {
    readonly claimId: string;
    readonly claim: import("@/server/ai/providers").ExtractedClaim;
    readonly evidencePackageId: string;
  }) => Promise<string>,
) {
  const job = await repository.get(payload);
  if (!job || job.run_id !== runId || job.status !== "running")
    return { outcome: "obsolete" } as const;
  const transcript = await repository.getTranscript(job.content_item_id);
  if (!transcript) throw new PermanentWorkflowError("TRANSCRIPT_MISSING");
  const extractionId = await repository.getClaimExtractionId(transcript.id);
  if (!extractionId)
    throw new PermanentWorkflowError("CLAIM_EXTRACTION_MISSING");
  if (!(await repository.setStage(payload, runId, "judge_claims", attempt)))
    return { outcome: "obsolete" } as const;

  const claims = await repository.listClaims(extractionId);
  let packages: Awaited<ReturnType<typeof repository.listEvidencePackages>>;
  try {
    packages = await repository.listEvidencePackages(
      claims.map(({ id }) => id),
    );
  } catch (error) {
    if (error instanceof FactCheckJudgmentError)
      throw new PermanentWorkflowError("EVIDENCE_PACKAGE_INVALID");
    throw error;
  }
  const packageByClaim = new Map(
    packages.map(({ claimId, evidencePackageId, packageClaim }) => [
      claimId,
      { evidencePackageId, packageClaim },
    ]),
  );
  const targets = claims.map(({ id, claim }) => {
    const packageRecord = packageByClaim.get(id);
    if (!packageRecord)
      throw new PermanentWorkflowError("EVIDENCE_PACKAGE_MISSING");
    if (!sameExtractedClaim(claim, packageRecord.packageClaim))
      throw new PermanentWorkflowError("EVIDENCE_PACKAGE_CLAIM_MISMATCH");
    return {
      claimId: id,
      claim,
      evidencePackageId: packageRecord.evidencePackageId,
    };
  });
  const completedPairs = await repository.existingFactCheckPairs(targets);
  const completed = new Set(
    completedPairs.map(({ claimId, evidencePackageId }) =>
      JSON.stringify([claimId, evidencePackageId]),
    ),
  );

  for (const target of targets) {
    if (
      completed.has(JSON.stringify([target.claimId, target.evidencePackageId]))
    )
      continue;
    await judgeClaim(target);
  }

  const finished = await repository.advance(
    payload,
    runId,
    "completed",
    attempt,
  );
  return { outcome: finished ? "fact_checks_ready" : "obsolete" } as const;
}

/** Test helper for the screening/transcription stages; production uses the staged Worker entrypoint. */
export async function executeWorkflow(
  payload: JobPayload,
  runId: string,
  attempt: number,
  repository: WorkflowRepository,
  inspectVideo: (path: string) => Promise<VideoInspection>,
  transcribeVideo: (input: ScreenInput) => Promise<TranscriptionResult>,
  screenVideo: (input: ScreenInput) => Promise<VideoScreening> = async () =>
    uncertainScreening("sample_unavailable"),
) {
  const screening = await executeScreeningStage(
    payload,
    runId,
    attempt,
    repository,
    inspectVideo,
    screenVideo,
  );
  if (screening.outcome !== "ready_for_transcription") return screening;
  return executeTranscriptionStage(
    payload,
    runId,
    attempt,
    repository,
    inspectVideo,
    transcribeVideo,
  );
}

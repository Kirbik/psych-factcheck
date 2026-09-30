import { isOwnedGeneratedVideoPath } from "@/server/storage/video-upload-path";
import {
  validateVideoBytes,
  validateVideoMetadata,
  VideoValidationError,
} from "@/server/storage/video-validator";
import type { JobPayload } from "@/features/analysis/job-contract";
import type {
  TranscriptionResult,
} from "@/server/ai/providers";
import { MAX_OPENAI_TRANSCRIPTION_BYTES } from "@/server/ai/openai-transcription-provider";
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
    const metadata = validateVideoMetadata(content.original_file_name, actual.size);
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
    await repository.advance(payload, runId, "completed", attempt);
    return { outcome: "transcribed" } as const;
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
      screening = await repository.saveScreening(job.content_item_id, screening);
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
  const completed = await repository.advance(
    payload,
    runId,
    "completed",
    attempt,
  );
  return { outcome: completed ? "transcribed" : "obsolete" } as const;
}

/** Convenience runner retained for focused unit tests and non-Cloudflare callers. */
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

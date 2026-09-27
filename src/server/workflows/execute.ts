import { isOwnedGeneratedVideoPath } from "@/server/storage/video-upload-path";
import {
  validateVideoBytes,
  validateVideoMetadata,
  VideoValidationError,
} from "@/server/storage/video-validator";
import type { JobPayload } from "@/features/analysis/job-contract";
import type { WorkflowRepository } from "./repository";

export class PermanentWorkflowError extends Error {}

export async function executeWorkflow(
  payload: JobPayload,
  runId: string,
  attempt: number,
  repository: WorkflowRepository,
  inspectVideo: (path: string) => Promise<{ size: number; header: Uint8Array }>,
) {
  const job = await repository.advance(payload, runId, "running", attempt);
  if (!job) return { outcome: "obsolete" } as const;
  const content = await repository.content(job);
  if (
    !content?.storage_path ||
    !content.original_file_name ||
    !isOwnedGeneratedVideoPath(content.storage_path, job.user_id)
  ) {
    throw new PermanentWorkflowError("INVALID_UPLOAD");
  }
  const actual = await inspectVideo(content.storage_path);
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
  // This is completion of orchestration only. Never mark content ready or create AI artifacts.
  const completed = await repository.advance(
    payload,
    runId,
    "completed",
    attempt,
  );
  return { outcome: completed ? "prepared" : "obsolete" } as const;
}

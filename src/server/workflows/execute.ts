import { isOwnedGeneratedVideoPath } from "@/server/storage/video-upload-path";
import {
  validateVideoBytes,
  validateVideoMetadata,
  VideoValidationError,
} from "@/server/storage/video-validator";
import type { JobPayload } from "@/features/analysis/job-contract";
import type { TranscriptionResult } from "@/server/ai/providers";
import type { WorkflowRepository } from "./repository";

export class PermanentWorkflowError extends Error {}

export async function executeWorkflow(
  payload: JobPayload,
  runId: string,
  attempt: number,
  repository: WorkflowRepository,
  inspectVideo: (path: string) => Promise<{ size: number; header: Uint8Array }>,
  transcribeVideo: (input: {
    storagePath: string;
    fileName: string;
    contentType: string;
    size: number;
  }) => Promise<TranscriptionResult>,
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
  if (
    !(await repository.setStage(payload, runId, "transcribe_video", attempt))
  ) {
    return { outcome: "obsolete" } as const;
  }
  if (!(await repository.hasTranscript(job.content_item_id))) {
    const transcript = await transcribeVideo({
      storagePath: content.storage_path,
      fileName: content.original_file_name,
      contentType: content.file_mime_type,
      size: actual.size,
    });
    await repository.saveTranscript(
      job.content_item_id,
      "openai",
      "whisper-1",
      transcript,
    );
  }
  // Transcription is complete; later AI stages and content readiness remain pending.
  const completed = await repository.advance(
    payload,
    runId,
    "completed",
    attempt,
  );
  return { outcome: completed ? "transcribed" : "obsolete" } as const;
}

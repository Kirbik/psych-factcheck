"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  uploadVideoFile,
  type VideoUploadResult,
} from "@/features/analysis/video-upload-client";
import type { JobView } from "@/features/analysis/job-contract";
import {
  deleteVideoFileHandle,
  getVideoFileFromHandle,
  getStoredVideoFileHandle,
  type PersistentFileHandle,
} from "@/features/analysis/video-file-access";
import { z } from "zod";

const activeContentItemStorageKey = "psych-factcheck:active-content-item:v1";
const contentItemIdSchema = z.uuid();
const restoringSnapshot = "restoring";
const storageListeners = new Set<() => void>();
const storedUploadStateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("uploading"),
    uploadId: z.uuid(),
    fileName: z.string(),
    fileSizeBytes: z.number().int().nonnegative(),
    lastModified: z.number().nonnegative(),
    progressPercent: z.number().int().min(0).max(100),
  }),
  z.object({
    kind: z.literal("analysis"),
    contentItemId: z.uuid(),
  }),
]);
type StoredUploadState = z.infer<typeof storedUploadStateSchema>;

function subscribeToActiveContentItem(onChange: () => void) {
  storageListeners.add(onChange);
  return () => {
    storageListeners.delete(onChange);
  };
}

function getActiveContentItemSnapshot() {
  try {
    const snapshot = window.sessionStorage.getItem(activeContentItemStorageKey);
    if (!snapshot) return null;
    if (contentItemIdSchema.safeParse(snapshot).success) return snapshot;
    const parsed: unknown = JSON.parse(snapshot);
    return storedUploadStateSchema.safeParse(parsed).success ? snapshot : null;
  } catch {
    return null;
  }
}

function parseStoredUploadState(
  snapshot: string | null | typeof restoringSnapshot,
): StoredUploadState | null {
  if (!snapshot || snapshot === restoringSnapshot) return null;
  if (contentItemIdSchema.safeParse(snapshot).success) {
    return { kind: "analysis", contentItemId: snapshot };
  }
  try {
    const parsed: unknown = JSON.parse(snapshot);
    const result = storedUploadStateSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function notifyActiveContentItemChanged() {
  for (const listener of storageListeners) listener();
}

function saveActiveUploadState(state: StoredUploadState) {
  try {
    window.sessionStorage.setItem(
      activeContentItemStorageKey,
      JSON.stringify(state),
    );
  } catch {
    // Preserve the active workflow in memory if storage is unavailable.
  }
  notifyActiveContentItemChanged();
}

function clearActiveUploadState(expectedId: string) {
  try {
    const snapshot = window.sessionStorage.getItem(activeContentItemStorageKey);
    const state = parseStoredUploadState(snapshot);
    const currentId =
      state?.kind === "analysis" ? state.contentItemId : state?.uploadId;
    if (currentId === expectedId) {
      window.sessionStorage.removeItem(activeContentItemStorageKey);
    }
  } catch {
    // A stale storage entry is harmless; workflow state remains authoritative.
  }
  notifyActiveContentItemChanged();
}

export type VideoUploadTask = {
  uploadId: string;
  fileName: string;
  status: "processing" | "interrupted" | "completed" | "failed";
  fileSizeBytes?: number;
  lastModified?: number;
  progressPercent?: number;
  workflowStatus?: JobView["status"];
  error?: string;
  result?: VideoUploadResult;
};

function createRestoredTask(state: StoredUploadState): VideoUploadTask {
  if (state.kind === "uploading") {
    return {
      uploadId: state.uploadId,
      fileName: state.fileName,
      fileSizeBytes: state.fileSizeBytes,
      lastModified: state.lastModified,
      progressPercent: state.progressPercent,
      status: "interrupted",
    };
  }
  return {
    uploadId: state.contentItemId,
    fileName: "Видео",
    status: "completed",
    workflowStatus: "queued",
    result: { contentItemId: state.contentItemId, duplicate: false },
  };
}

function isVideoUploadLocked(task: VideoUploadTask | null) {
  if (!task) return false;
  if (task.status === "processing" || task.status === "interrupted")
    return true;
  return (
    task.status === "completed" &&
    (task.workflowStatus === undefined ||
      task.workflowStatus === "queued" ||
      task.workflowStatus === "running")
  );
}

type VideoUploadContextValue = {
  task: VideoUploadTask | null;
  isRestoring: boolean;
  isResumeHandleLoading: boolean;
  isUploadLocked: boolean;
  startUpload: (file: File, uploadId: string) => boolean;
  resumeInterruptedUpload: () => Promise<boolean>;
  clearTask: () => void;
  updateWorkflowStatus: (
    contentItemId: string,
    status: JobView["status"],
  ) => void;
};

const VideoUploadContext = createContext<VideoUploadContextValue | null>(null);

export function VideoUploadProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [task, setTask] = useState<VideoUploadTask | null>(null);
  const taskRef = useRef<VideoUploadTask | null>(null);
  const resumeInProgress = useRef(false);
  const resumeHandleRef = useRef<{
    uploadId: string;
    handle: PersistentFileHandle;
  } | null>(null);
  const [loadedResumeHandleId, setLoadedResumeHandleId] = useState<
    string | null
  >(null);
  const activeContentItemSnapshot = useSyncExternalStore(
    subscribeToActiveContentItem,
    getActiveContentItemSnapshot,
    () => restoringSnapshot,
  );
  const isRestoring = activeContentItemSnapshot === restoringSnapshot;
  const storedUploadState = parseStoredUploadState(activeContentItemSnapshot);
  const restoredTask = storedUploadState
    ? createRestoredTask(storedUploadState)
    : null;
  const currentTask = task ?? restoredTask;
  const interruptedUploadId =
    currentTask?.status === "interrupted" ? currentTask.uploadId : null;

  useEffect(() => {
    resumeHandleRef.current = null;
    if (!interruptedUploadId) return;
    let active = true;
    void getStoredVideoFileHandle(interruptedUploadId).then((handle) => {
      if (!active) return;
      resumeHandleRef.current = handle
        ? { uploadId: interruptedUploadId, handle }
        : null;
      setLoadedResumeHandleId(interruptedUploadId);
    });
    return () => {
      active = false;
    };
  }, [interruptedUploadId]);

  const updateTask = useCallback((nextTask: VideoUploadTask | null) => {
    taskRef.current = nextTask;
    setTask(nextTask);
  }, []);

  const updateUploadProgress = useCallback(
    (uploadId: string, progressPercent: number) => {
      const current = taskRef.current;
      if (
        current?.uploadId !== uploadId ||
        current.status !== "processing" ||
        current.progressPercent === progressPercent
      ) {
        return;
      }
      const next = { ...current, progressPercent };
      updateTask(next);
      saveActiveUploadState({
        kind: "uploading",
        uploadId,
        fileName: current.fileName,
        fileSizeBytes: current.fileSizeBytes ?? 0,
        lastModified: current.lastModified ?? 0,
        progressPercent,
      });
    },
    [updateTask],
  );

  const startUpload = useCallback(
    (file: File, uploadId: string) => {
      const current = taskRef.current ?? restoredTask;
      const isMatchingResume =
        current?.status === "interrupted" &&
        current.uploadId === uploadId &&
        current.fileName === file.name &&
        current.fileSizeBytes === file.size &&
        current.lastModified === file.lastModified;
      if (isRestoring || (isVideoUploadLocked(current) && !isMatchingResume))
        return false;

      const initialTask: VideoUploadTask = {
        uploadId,
        fileName: file.name,
        status: "processing",
        fileSizeBytes: file.size,
        lastModified: file.lastModified,
        progressPercent: isMatchingResume ? current.progressPercent : 0,
      };
      updateTask(initialTask);
      saveActiveUploadState({
        kind: "uploading",
        uploadId,
        fileName: file.name,
        fileSizeBytes: file.size,
        lastModified: file.lastModified,
        progressPercent: initialTask.progressPercent ?? 0,
      });

      void uploadVideoFile(file, uploadId, (progressPercent) => {
        updateUploadProgress(uploadId, progressPercent);
      })
        .then((result) => {
          const current = taskRef.current;
          if (current?.uploadId === uploadId) {
            void deleteVideoFileHandle(uploadId);
            if (contentItemIdSchema.safeParse(result.contentItemId).success) {
              saveActiveUploadState({
                kind: "analysis",
                contentItemId: result.contentItemId,
              });
            }
            updateTask({
              ...current,
              status: "completed",
              workflowStatus: "queued",
              result,
            });
          }
        })
        .catch((error: unknown) => {
          const current = taskRef.current;
          if (current?.uploadId === uploadId) {
            void deleteVideoFileHandle(uploadId);
            clearActiveUploadState(uploadId);
            updateTask({
              ...current,
              status: "failed",
              error:
                error instanceof Error
                  ? error.message
                  : "Не удалось загрузить видео.",
            });
          }
        });

      return true;
    },
    [isRestoring, restoredTask, updateTask, updateUploadProgress],
  );

  const resumeInterruptedUpload = useCallback(async () => {
    const current = taskRef.current ?? restoredTask;
    if (
      resumeInProgress.current ||
      current?.status !== "interrupted" ||
      isRestoring
    ) {
      return false;
    }
    resumeInProgress.current = true;
    try {
      const storedHandle = resumeHandleRef.current;
      if (!storedHandle || storedHandle.uploadId !== current.uploadId) {
        return false;
      }
      const file = await getVideoFileFromHandle(storedHandle.handle);
      if (
        !file ||
        file.name !== current.fileName ||
        file.size !== current.fileSizeBytes ||
        file.lastModified !== current.lastModified
      ) {
        return false;
      }
      return startUpload(file, current.uploadId);
    } finally {
      resumeInProgress.current = false;
    }
  }, [isRestoring, restoredTask, startUpload]);

  const clearTask = useCallback(() => {
    const current = taskRef.current ?? restoredTask;
    if (!isVideoUploadLocked(current)) {
      if (current?.status === "completed" || current?.status === "failed")
        void deleteVideoFileHandle(current.uploadId);
      const contentItemId = current?.result?.contentItemId;
      if (contentItemId) clearActiveUploadState(contentItemId);
      updateTask(null);
    }
  }, [restoredTask, updateTask]);

  const updateWorkflowStatus = useCallback(
    (contentItemId: string, workflowStatus: JobView["status"]) => {
      const current = taskRef.current ?? restoredTask;
      if (
        current?.status === "completed" &&
        current.result?.contentItemId === contentItemId
      ) {
        updateTask({ ...current, workflowStatus });
        if (
          workflowStatus === "completed" ||
          workflowStatus === "failed" ||
          workflowStatus === "cancelled"
        ) {
          clearActiveUploadState(contentItemId);
        }
      }
    },
    [restoredTask, updateTask],
  );

  return (
    <VideoUploadContext.Provider
      value={{
        task: currentTask,
        isRestoring,
        isResumeHandleLoading:
          interruptedUploadId !== null &&
          loadedResumeHandleId !== interruptedUploadId,
        isUploadLocked: isRestoring || isVideoUploadLocked(currentTask),
        startUpload,
        resumeInterruptedUpload,
        clearTask,
        updateWorkflowStatus,
      }}
    >
      {children}
    </VideoUploadContext.Provider>
  );
}

export function useVideoUpload() {
  const value = useContext(VideoUploadContext);
  if (!value) {
    throw new Error("useVideoUpload must be used within VideoUploadProvider");
  }
  return value;
}

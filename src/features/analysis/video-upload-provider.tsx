"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  uploadVideoFile,
  type VideoUploadResult,
} from "@/features/analysis/video-upload-client";
import type { JobView } from "@/features/analysis/job-contract";
import { z } from "zod";

const activeContentItemStorageKey = "psych-factcheck:active-content-item:v1";
const contentItemIdSchema = z.uuid();
const restoringSnapshot = "restoring";
const storageListeners = new Set<() => void>();

function subscribeToActiveContentItem(onChange: () => void) {
  storageListeners.add(onChange);
  return () => {
    storageListeners.delete(onChange);
  };
}

function getActiveContentItemSnapshot() {
  try {
    const storedId = window.sessionStorage.getItem(activeContentItemStorageKey);
    return storedId && contentItemIdSchema.safeParse(storedId).success
      ? storedId
      : null;
  } catch {
    return null;
  }
}

function notifyActiveContentItemChanged() {
  for (const listener of storageListeners) listener();
}

function saveActiveContentItem(contentItemId: string) {
  try {
    window.sessionStorage.setItem(activeContentItemStorageKey, contentItemId);
  } catch {
    // Preserve the active workflow in memory if storage is unavailable.
  }
  notifyActiveContentItemChanged();
}

function clearActiveContentItem(contentItemId: string) {
  try {
    if (
      window.sessionStorage.getItem(activeContentItemStorageKey) ===
      contentItemId
    ) {
      window.sessionStorage.removeItem(activeContentItemStorageKey);
    }
  } catch {
    // A stale storage entry is harmless; workflow state remains authoritative.
  }
  notifyActiveContentItemChanged();
}

function createRestoredTask(contentItemId: string): VideoUploadTask {
  return {
    uploadId: contentItemId,
    fileName: "Видео",
    status: "completed",
    workflowStatus: "queued",
    result: { contentItemId, duplicate: false },
  };
}

export type VideoUploadTask = {
  uploadId: string;
  fileName: string;
  status: "processing" | "completed" | "failed";
  workflowStatus?: JobView["status"];
  error?: string;
  result?: VideoUploadResult;
};

function isVideoUploadLocked(task: VideoUploadTask | null) {
  if (!task) return false;
  if (task.status === "processing") return true;
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
  isUploadLocked: boolean;
  startUpload: (file: File, uploadId: string) => boolean;
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
  const activeContentItemSnapshot = useSyncExternalStore(
    subscribeToActiveContentItem,
    getActiveContentItemSnapshot,
    () => restoringSnapshot,
  );
  const isRestoring = activeContentItemSnapshot === restoringSnapshot;
  const restoredTask =
    !isRestoring && activeContentItemSnapshot
      ? createRestoredTask(activeContentItemSnapshot)
      : null;
  const currentTask = task ?? restoredTask;

  const updateTask = useCallback((nextTask: VideoUploadTask | null) => {
    taskRef.current = nextTask;
    setTask(nextTask);
  }, []);

  const startUpload = useCallback(
    (file: File, uploadId: string) => {
      if (isRestoring || isVideoUploadLocked(taskRef.current ?? restoredTask))
        return false;

      const initialTask: VideoUploadTask = {
        uploadId,
        fileName: file.name,
        status: "processing",
      };
      updateTask(initialTask);

      void uploadVideoFile(file, uploadId)
        .then((result) => {
          const current = taskRef.current;
          if (current?.uploadId === uploadId) {
            if (contentItemIdSchema.safeParse(result.contentItemId).success) {
              saveActiveContentItem(result.contentItemId);
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
    [isRestoring, restoredTask, updateTask],
  );

  const clearTask = useCallback(() => {
    if (!isVideoUploadLocked(taskRef.current ?? restoredTask)) {
      const contentItemId = (taskRef.current ?? restoredTask)?.result
        ?.contentItemId;
      if (contentItemId) clearActiveContentItem(contentItemId);
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
          clearActiveContentItem(contentItemId);
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
        isUploadLocked: isRestoring || isVideoUploadLocked(currentTask),
        startUpload,
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

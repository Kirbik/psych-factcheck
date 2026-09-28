"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import {
  uploadVideoFile,
  type VideoUploadResult,
} from "@/features/analysis/video-upload-client";
import type { JobView } from "@/features/analysis/job-contract";

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

  const updateTask = useCallback((nextTask: VideoUploadTask | null) => {
    taskRef.current = nextTask;
    setTask(nextTask);
  }, []);

  const startUpload = useCallback(
    (file: File, uploadId: string) => {
      if (isVideoUploadLocked(taskRef.current)) return false;

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
    [updateTask],
  );

  const clearTask = useCallback(() => {
    if (!isVideoUploadLocked(taskRef.current)) updateTask(null);
  }, [updateTask]);

  const updateWorkflowStatus = useCallback(
    (contentItemId: string, workflowStatus: JobView["status"]) => {
      const current = taskRef.current;
      if (
        current?.status === "completed" &&
        current.result?.contentItemId === contentItemId
      ) {
        updateTask({ ...current, workflowStatus });
      }
    },
    [updateTask],
  );

  return (
    <VideoUploadContext.Provider
      value={{
        task,
        isUploadLocked: isVideoUploadLocked(task),
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

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

export type VideoUploadTask = {
  uploadId: string;
  fileName: string;
  status: "processing" | "completed" | "failed";
  error?: string;
  result?: VideoUploadResult;
};

type VideoUploadContextValue = {
  task: VideoUploadTask | null;
  startUpload: (file: File, uploadId: string) => boolean;
  clearTask: () => void;
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
      if (taskRef.current?.status === "processing") return false;

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
            updateTask({ ...current, status: "completed", result });
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
    if (taskRef.current?.status !== "processing") updateTask(null);
  }, [updateTask]);

  return (
    <VideoUploadContext.Provider value={{ task, startUpload, clearTask }}>
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

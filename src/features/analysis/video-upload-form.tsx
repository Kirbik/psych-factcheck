"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/components/product/upload-dropzone";
import { useVideoUpload } from "@/features/analysis/video-upload-provider";
import { workflowMessages } from "@/features/analysis/job-contract";

export function VideoUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [uploadId, setUploadId] = useState(() => crypto.randomUUID());
  const { task, startUpload, clearTask, isUploadLocked } = useVideoUpload();
  const refreshedUploadId = useRef<string | null>(null);

  useEffect(() => {
    if (
      task?.status === "completed" &&
      refreshedUploadId.current !== task.uploadId
    ) {
      refreshedUploadId.current = task.uploadId;
      router.refresh();
    }
  }, [router, task]);

  function submit() {
    if (isUploadLocked) return;
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setFileError("Выберите видеофайл.");
      return;
    }
    setFileError("");
    clearTask();
    startUpload(file, uploadId);
  }

  const isUploading = task?.status === "processing";
  const isWorkflowActive = isUploadLocked && task?.status === "completed";
  const status = task?.status;
  const message =
    fileError ||
    (isUploading
      ? "Загрузка видео выполняется."
      : isWorkflowActive
        ? workflowMessages[task.workflowStatus ?? "queued"]
        : status === "completed"
          ? "Видео загружено. Запись проверки сохранена."
          : status === "failed"
            ? task?.error ?? "Не удалось загрузить видео."
            : "");
  const displayedFileName = isUploadLocked && task ? task.fileName : fileName;

  return (
    <form
      aria-describedby="video-upload-help video-upload-status"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <UploadDropzone
        description="Форматы: .mp4, .webm и .mov, до 100 МБ. Файл останется доступен только вам."
        title="Загрузите видео для проверки"
      >
        <label className="button button--secondary" htmlFor="video-upload-file">
          Выбрать файл
          <input
            accept="video/mp4,video/webm,video/quicktime"
            aria-describedby="video-upload-help"
            className="upload-file-input"
            disabled={isUploadLocked}
            id="video-upload-file"
            onChange={(event) => {
              if (isUploadLocked) return;
              setFileName(event.target.files?.[0]?.name ?? "");
              setUploadId(crypto.randomUUID());
              setFileError("");
              clearTask();
            }}
            ref={inputRef}
            type="file"
          />
        </label>
        <p id="video-upload-help" className="muted-text">
          {displayedFileName || "Файл ещё не выбран"}
        </p>
        <Button disabled={isUploadLocked} loading={isUploading} type="submit">
          {isUploading ? "Загружаем…" : "Загрузить видео"}
        </Button>
      </UploadDropzone>
      {message ? (
        <p
          className={
            status === "failed" || fileError
              ? "validation-error validation-error--summary"
              : "upload-status"
          }
          id="video-upload-status"
          role={status === "failed" || fileError ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
      {task?.status === "completed" && task.result ? (
        <Link className="button button--secondary" href={`/processing?contentItemId=${task.result.contentItemId}`}>
          Продолжить
        </Link>
      ) : null}
    </form>
  );
}

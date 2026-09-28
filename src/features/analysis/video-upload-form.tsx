"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/components/product/upload-dropzone";
import { useVideoUpload } from "@/features/analysis/video-upload-provider";
import { workflowMessages } from "@/features/analysis/job-contract";
import {
  deleteVideoFileHandle,
  pickVideoFileWithHandle,
  saveVideoFileHandle,
  supportsPersistentVideoAccess,
} from "@/features/analysis/video-file-access";

export function VideoUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [uploadId, setUploadId] = useState(() => crypto.randomUUID());
  const {
    task,
    startUpload,
    resumeInterruptedUpload,
    clearTask,
    isUploadLocked,
    isResumeHandleLoading,
  } = useVideoUpload();
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

  async function submit() {
    const isInterrupted = task?.status === "interrupted";
    if (isUploadLocked && !isInterrupted) return;
    if (isInterrupted) {
      if (await resumeInterruptedUpload()) return;
      const file = selectedFile ?? inputRef.current?.files?.[0];
      if (!file) {
        setFileError("Не найден доступ к файлу. Выберите его ещё раз.");
        return;
      }
      if (
        file.name !== task.fileName ||
        file.size !== task.fileSizeBytes ||
        file.lastModified !== task.lastModified
      ) {
        setFileError(`Выберите исходный файл «${task.fileName}».`);
        return;
      }
      setFileError("");
      startUpload(file, task.uploadId);
      return;
    }
    const file = selectedFile ?? inputRef.current?.files?.[0];
    if (!file) {
      setFileError("Выберите видеофайл.");
      return;
    }
    setFileError("");
    clearTask();
    startUpload(file, uploadId);
  }

  const isUploading = task?.status === "processing";
  const isInterrupted = task?.status === "interrupted";
  const isWorkflowActive = isUploadLocked && task?.status === "completed";
  const status = task?.status;
  const message =
    fileError ||
    (isUploading
      ? "Загрузка видео выполняется."
      : isInterrupted
        ? "Загрузка остановилась после перезагрузки. Нажмите «Продолжить загрузку», чтобы возобновить её."
        : isWorkflowActive
          ? workflowMessages[task.workflowStatus ?? "queued"]
          : status === "completed"
            ? "Видео загружено. Запись проверки сохранена."
            : status === "failed"
              ? (task?.error ?? "Не удалось загрузить видео.")
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
            disabled={isUploadLocked && !isInterrupted}
            id="video-upload-file"
            onClick={(event) => {
              if (!supportsPersistentVideoAccess()) return;
              event.preventDefault();
              void pickVideoFileWithHandle()
                .then(async (selection) => {
                  if (!selection) return;
                  const currentUpload = isInterrupted ? task : null;
                  const nextUploadId =
                    currentUpload?.uploadId ?? crypto.randomUUID();
                  if (!currentUpload) void deleteVideoFileHandle(uploadId);
                  const saved = await saveVideoFileHandle(
                    nextUploadId,
                    selection.handle,
                  );
                  setUploadId(nextUploadId);
                  setSelectedFile(selection.file);
                  setFileName(selection.file.name);
                  setFileError(
                    saved
                      ? ""
                      : "Браузер не сохранил доступ к файлу для продолжения после перезагрузки.",
                  );
                  if (!currentUpload) clearTask();
                })
                .catch(() =>
                  setFileError("Не удалось открыть выбранный видеофайл."),
                );
            }}
            onChange={(event) => {
              if (isUploadLocked && !isInterrupted) return;
              const file = event.target.files?.[0] ?? null;
              setSelectedFile(file);
              setFileName(file?.name ?? "");
              if (!isInterrupted) {
                void deleteVideoFileHandle(uploadId);
                setUploadId(crypto.randomUUID());
              }
              setFileError("");
              if (!isInterrupted) clearTask();
            }}
            ref={inputRef}
            type="file"
          />
        </label>
        <p id="video-upload-help" className="muted-text">
          {displayedFileName || "Файл ещё не выбран"}
        </p>
        <Button
          disabled={
            (isUploadLocked && !isInterrupted) ||
            (isInterrupted && isResumeHandleLoading)
          }
          loading={isUploading}
          type="submit"
        >
          {isUploading
            ? "Загружаем…"
            : isInterrupted
              ? "Продолжить загрузку"
              : "Загрузить видео"}
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
        <Link
          className="button button--secondary"
          href={`/processing?contentItemId=${task.result.contentItemId}`}
        >
          Продолжить
        </Link>
      ) : null}
    </form>
  );
}

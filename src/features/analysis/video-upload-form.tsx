"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/components/product/upload-dropzone";
import { uploadVideoFile } from "@/features/analysis/video-upload-client";

type UploadState = "idle" | "uploading" | "success" | "error";

export function VideoUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [uploadId, setUploadId] = useState(() => crypto.randomUUID());

  async function submit() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setState("error");
      setMessage("Выберите видеофайл.");
      return;
    }

    setState("uploading");
    setMessage("");
    try {
      await uploadVideoFile(file, uploadId);
      setState("success");
      setMessage("Видео загружено. Запись проверки сохранена.");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Не удалось загрузить видео.",
      );
    }
  }

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
            id="video-upload-file"
            onChange={(event) => {
              setFileName(event.target.files?.[0]?.name ?? "");
              setUploadId(crypto.randomUUID());
              setState("idle");
              setMessage("");
            }}
            ref={inputRef}
            type="file"
          />
        </label>
        <p id="video-upload-help" className="muted-text">
          {fileName || "Файл ещё не выбран"}
        </p>
        <Button loading={state === "uploading"} type="submit">
          {state === "uploading" ? "Загружаем…" : "Загрузить видео"}
        </Button>
      </UploadDropzone>
      {message ? (
        <p
          className={
            state === "error"
              ? "validation-error validation-error--summary"
              : "upload-status"
          }
          id="video-upload-status"
          role={state === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}

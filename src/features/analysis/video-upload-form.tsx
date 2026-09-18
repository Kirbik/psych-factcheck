"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/components/product/upload-dropzone";

type UploadState = "idle" | "uploading" | "success" | "error";

export function VideoUploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [uploadId] = useState(() => crypto.randomUUID());

  async function submit() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setState("error");
      setMessage("Выберите видеофайл.");
      return;
    }

    setState("uploading");
    setMessage("");
    const formData = new FormData();
    formData.set("video", file);
    formData.set("upload_id", uploadId);
    try {
      const response = await fetch("/api/uploads/video", { method: "POST", body: formData });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить видео.");
      setState("success");
      setMessage("Видео загружено. Запись проверки сохранена.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить видео.");
    }
  }

  return (
    <form
      aria-describedby="video-upload-help video-upload-status"
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
    >
      <UploadDropzone
        description="MP4, WebM или MOV, до 100 МБ. Файл останется доступен только вам."
        title="Загрузите видео для проверки"
      >
        <label className="button button--secondary" htmlFor="video-upload-file">
          Выбрать файл
          <input
            accept="video/mp4,video/webm,video/quicktime"
            aria-describedby="video-upload-help"
            className="upload-file-input"
            id="video-upload-file"
            onChange={(event) => { setFileName(event.target.files?.[0]?.name ?? ""); setState("idle"); setMessage(""); }}
            ref={inputRef}
            type="file"
          />
        </label>
        <p id="video-upload-help" className="muted-text">{fileName || "Файл ещё не выбран"}</p>
        <Button loading={state === "uploading"} type="submit">
          {state === "uploading" ? "Загружаем…" : "Загрузить видео"}
        </Button>
      </UploadDropzone>
      {message ? <p id="video-upload-status" role={state === "error" ? "alert" : "status"}>{message}</p> : null}
    </form>
  );
}

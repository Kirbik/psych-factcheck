"use client";

import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import { useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { ProcessingPreview } from "@/components/preview/processing-preview";
import { useVideoUpload } from "@/features/analysis/video-upload-provider";
import {
  deleteVideoFileHandle,
  pickVideoFileWithHandle,
  saveVideoFileHandle,
  supportsPersistentVideoAccess,
} from "@/features/analysis/video-file-access";
import { WorkflowProgress } from "@/features/analysis/workflow-progress";
import styles from "./history-preview.module.css";
import newStyles from "./new-check-preview.module.css";

const inter = Inter({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-inter", weight: ["400", "500", "600"] });
const lora = Lora({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-lora", weight: ["600"] });

export function NewCheckPreview() {
  const [activeTab, setActiveTab] = useState("video");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadId, setUploadId] = useState(() => crypto.randomUUID());
  const {
    task,
    startUpload,
    cancelUpload,
    resumeInterruptedUpload,
    clearTask,
    isRestoring,
    isResumeHandleLoading,
  } = useVideoUpload();

  function submitUpload() {
    if (!videoFile) return;
    clearTask();
    startUpload(videoFile, uploadId);
  }

  function resetSelectedVideo() {
    void deleteVideoFileHandle(uploadId);
    setVideoFile(null);
    setUploadId(crypto.randomUUID());
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleCancelUpload() {
    if (!cancelUpload()) return;
    resetSelectedVideo();
  }

  function handleBackFromWorkflow() {
    clearTask();
    resetSelectedVideo();
  }

  function handleFilePickerClick(event: MouseEvent<HTMLInputElement>) {
    if (!supportsPersistentVideoAccess()) return;
    event.preventDefault();
    void pickVideoFileWithHandle()
      .then(async (selection) => {
        if (!selection) return;
        void deleteVideoFileHandle(uploadId);
        const nextUploadId = crypto.randomUUID();
        await saveVideoFileHandle(nextUploadId, selection.handle);
        setUploadId(nextUploadId);
        setVideoFile(selection.file);
      })
      .catch(() => undefined);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    void deleteVideoFileHandle(uploadId);
    setVideoFile(file);
    setUploadId(crypto.randomUUID());
  }

  if (isRestoring) {
    return (
      <ProcessingPreview
        uploadStatus="completed"
        workflowMessage="Видео сохранено. Получаем состояние подготовки."
      />
    );
  }

  if (task) {
    if (task.status === "completed" && task.result) {
      return (
        <WorkflowProgress
          contentItemId={task.result.contentItemId}
          onBack={handleBackFromWorkflow}
        />
      );
    }
    if (task.status === "interrupted") {
      return (
      <ProcessingPreview
          onCancel={handleCancelUpload}
          uploadStatus="interrupted"
          resumeDisabled={isResumeHandleLoading}
          progressPercent={task.progressPercent}
          workflowMessage="Загрузка остановилась после перезагрузки. Нажмите «Продолжить загрузку», чтобы возобновить её."
          resumeFile={{
            fileName: task.fileName,
            fileSizeBytes: task.fileSizeBytes ?? 0,
            lastModified: task.lastModified ?? 0,
            onResume: resumeInterruptedUpload,
            onSelect: (file) => startUpload(file, task.uploadId),
          }}
        />
      );
    }
    return (
        <ProcessingPreview
        onCancel={handleCancelUpload}
        onBack={() => {
          if (task.status !== "processing") handleBackFromWorkflow();
        }}
        uploadError={task.error}
        uploadStatus={task.status === "processing" ? "processing" : task.status}
        progressPercent={task.progressPercent}
      />
    );
  }

  return <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Псих Фактчек — проверки"><span className={styles.mark}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="m8.4 12.1 2.2 2.2 4.9-5" /></svg></span>Псих Фактчек</Link>
      <nav className={styles.nav} aria-label="Навигация приложения"><Link className={styles.navActive} href="/history" aria-current="page">Проверки</Link><Link href="/profile">Профиль</Link></nav>
    </header>
    <section className={`${styles.content} ${newStyles.content}`} aria-labelledby="new-check-title">
      <Link className={newStyles.back} href="/history"><span aria-hidden="true">←</span> Все проверки</Link>
      <h1 className={newStyles.title} id="new-check-title">Новая проверка</h1>
      <div className={newStyles.tabs} role="tablist" aria-label="Тип проверки">
        <button className={activeTab === "video" ? newStyles.tabActive : newStyles.tab} onClick={() => setActiveTab("video")} role="tab" aria-selected={activeTab === "video"} type="button">Проверка видеофайла</button>
        <button className={newStyles.tab} disabled role="tab" aria-selected="false" type="button">Проверка рилса</button>
        <button className={newStyles.tab} disabled role="tab" aria-selected="false" type="button">Проверка аккаунта в инстаграмм</button>
      </div>
      {activeTab === "video" ? <form className={newStyles.card} onSubmit={(event) => { event.preventDefault(); submitUpload(); }}>
        <div><h2>Загрузите видеофайл</h2><p className={newStyles.help}>Выберите видеофайл для проверки утверждений.</p></div>
        {videoFile ? <div className={newStyles.fileRow}><div className={newStyles.fileInfo}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5zM15 4v5h4" /></svg><div><strong>{videoFile.name}</strong><small>{Math.max(1, Math.round(videoFile.size / 1024))} КБ</small></div></div><button className={newStyles.removeFile} onClick={() => { void deleteVideoFileHandle(uploadId); setVideoFile(null); setUploadId(crypto.randomUUID()); if (fileInputRef.current) fileInputRef.current.value = ""; }} type="button">Удалить файл</button></div> : <label className={newStyles.dropzone} htmlFor="video-file"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 16v3h14v-3" /></svg><span>Перетащите файл сюда или выберите его</span><small>Поддерживаемые форматы: .mp4, .webm и .mov</small><input ref={fileInputRef} id="video-file" name="video-file" onClick={handleFilePickerClick} onChange={handleFileInputChange} type="file" accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime" /></label>}
        <button className={newStyles.submit} disabled={!videoFile} type="submit">Продолжить</button>
      </form> : null}
    </section>
  </main>;
}

"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import styles from "./history-preview.module.css";
import processingStyles from "./processing-preview.module.css";

const inter = Inter({
  display: "swap",
  subsets: ["cyrillic", "latin"],
  variable: "--history-preview-inter",
  weight: ["400", "500", "600"],
});
const lora = Lora({
  display: "swap",
  subsets: ["cyrillic", "latin"],
  variable: "--history-preview-lora",
  weight: ["600"],
});

export type UploadProgressStatus =
  "pending" | "processing" | "interrupted" | "completed" | "failed";

type ProcessingPreviewProps = {
  onBack?: () => void;
  uploadError?: string;
  uploadStatus?: UploadProgressStatus;
  workflowMessage?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  retryDisabled?: boolean;
  resumeDisabled?: boolean;
  progressPercent?: number;
  resumeFile?: {
    fileName: string;
    fileSizeBytes: number;
    lastModified: number;
    onResume: () => Promise<boolean>;
    onSelect: (file: File) => boolean;
  };
};

type ProcessingStep = { label: string; status: UploadProgressStatus };

const statusLabels: Record<UploadProgressStatus, string> = {
  completed: "Готово",
  processing: "Выполняется",
  interrupted: "Приостановлено",
  pending: "Ожидает",
  failed: "Ошибка",
};

const stepLabels = [
  "Загрузка видео",
  "Создание транскрипта",
  "Выделение утверждений",
  "Поиск научных источников",
  "Сопоставление данных",
  "Подготовка отчета",
];

const titleByUploadStatus: Record<UploadProgressStatus, string> = {
  pending: "Прогресс проверки видео",
  processing: "Загружаем видео",
  interrupted: "Загрузка приостановлена",
  completed: "Видео загружено",
  failed: "Не удалось загрузить видео",
};

const subtitleByUploadStatus: Record<UploadProgressStatus, string> = {
  pending: "Загрузка видео ещё не начата.",
  processing: "Загрузка видео в защищённое хранилище выполняется.",
  interrupted: "Нажмите «Продолжить загрузку», чтобы возобновить её.",
  completed: "Видео загружено. Следующие этапы пока не запущены.",
  failed: "Проверьте файл и попробуйте загрузить его ещё раз.",
};

export function ProcessingPreview({
  onBack,
  uploadError,
  uploadStatus = "pending",
  workflowMessage,
  onRetry,
  onCancel,
  retryDisabled,
  resumeDisabled,
  progressPercent,
  resumeFile,
}: ProcessingPreviewProps) {
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const [resumeError, setResumeError] = useState("");
  const [needsManualSelection, setNeedsManualSelection] = useState(false);
  const steps: ProcessingStep[] = stepLabels.map((label, index) => ({
    label,
    status: index === 0 ? uploadStatus : "pending",
  }));
  const isComplete = steps.every((step) => step.status === "completed");

  function handleResume() {
    if (!resumeFile) return;
    if (needsManualSelection) {
      resumeInputRef.current?.click();
      return;
    }
    void resumeFile
      .onResume()
      .then((resumed) => {
        if (!resumed) {
          setResumeError(
            "Не удалось восстановить доступ к файлу. Выберите исходный файл, чтобы продолжить.",
          );
          setNeedsManualSelection(true);
        }
      })
      .catch(() => {
        setResumeError(
          "Не удалось восстановить доступ к файлу. Выберите исходный файл, чтобы продолжить.",
        );
        setNeedsManualSelection(true);
      });
  }

  return (
    <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
      <header className={styles.header}>
        <Link
          className={styles.brand}
          href="/"
          aria-label="Псих Фактчек — проверки"
        >
          <span className={styles.mark}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8.2" />
              <path d="m8.4 12.1 2.2 2.2 4.9-5" />
            </svg>
          </span>
          Псих Фактчек
        </Link>
        <nav className={styles.nav} aria-label="Навигация приложения">
          <Link
            className={styles.navActive}
            href="/history"
            aria-current="page"
          >
            Проверки
          </Link>
          <Link href="/profile">Профиль</Link>
        </nav>
      </header>
      <section
        className={`${styles.content} ${processingStyles.content}`}
        aria-labelledby="processing-title"
      >
        <Link
          className={processingStyles.back}
          href="/new-check"
          onClick={(event) => {
            if (!onBack) return;
            event.preventDefault();
            onBack();
          }}
        >
          <span aria-hidden="true">←</span> Новая проверка
        </Link>
        <h1 className={processingStyles.title} id="processing-title">
          {titleByUploadStatus[uploadStatus]}
        </h1>
        <p className={processingStyles.subtitle} aria-live="polite">
          {workflowMessage ?? subtitleByUploadStatus[uploadStatus]}
        </p>
        {uploadError ? (
          <p className={processingStyles.subtitle} role="alert">
            {uploadError}
          </p>
        ) : null}
        <div className={processingStyles.card}>
          <ol
            className={processingStyles.steps}
            aria-label="Прогресс проверки видео"
          >
            {steps.map((step, index) => (
              <li
                className={`${processingStyles.step} ${processingStyles[`step-${step.status === "interrupted" ? "pending" : step.status}`]}`}
                key={step.label}
              >
                <span className={processingStyles.indicator} aria-hidden="true">
                  {step.status === "completed"
                    ? "✓"
                    : step.status === "failed"
                      ? "×"
                      : ""}
                </span>
                <span className={processingStyles.stepLabel}>{step.label}</span>
                <span className={processingStyles.stepStatus}>
                  {index === 0 && progressPercent !== undefined
                    ? `${statusLabels[step.status]} · ${progressPercent}%`
                    : statusLabels[step.status]}
                  {index === 0 && resumeFile ? (
                    <button
                      className={processingStyles.resumeLink}
                      disabled={resumeDisabled}
                      onClick={handleResume}
                      type="button"
                    >
                      {needsManualSelection
                        ? "Выбрать файл и продолжить"
                        : "Продолжить загрузку"}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
          {resumeFile ? (
            <>
              <input
                accept="video/mp4,video/webm,video/quicktime"
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (!file) return;
                  if (
                    file.name !== resumeFile.fileName ||
                    file.size !== resumeFile.fileSizeBytes ||
                    file.lastModified !== resumeFile.lastModified
                  ) {
                    setResumeError(
                      `Выберите исходный файл «${resumeFile.fileName}».`,
                    );
                    setNeedsManualSelection(true);
                    return;
                  }
                  const resumed = resumeFile.onSelect(file);
                  setResumeError(
                    resumed
                      ? ""
                      : "Не удалось продолжить загрузку. Попробуйте выбрать исходный файл ещё раз.",
                  );
                  setNeedsManualSelection(!resumed);
                }}
                ref={resumeInputRef}
                type="file"
              />
              {resumeError ? (
                <p className={processingStyles.subtitle} role="alert">
                  {resumeError}
                </p>
              ) : null}
              {onCancel ? (
                <button
                  className={processingStyles.reportButton}
                  onClick={onCancel}
                  type="button"
                >
                  Отменить загрузку
                </button>
              ) : null}
            </>
          ) : onRetry ? (
            <button
              className={processingStyles.reportButton}
              type="button"
              onClick={onRetry}
              disabled={retryDisabled}
            >
              Повторить запуск
            </button>
          ) : uploadStatus === "processing" && onCancel ? (
            <button
              className={processingStyles.reportButton}
              onClick={onCancel}
              type="button"
            >
              Отменить загрузку
            </button>
          ) : (
            <Link
              className={`${processingStyles.reportButton} ${!isComplete ? processingStyles.disabled : ""}`}
              aria-disabled={!isComplete}
              href={isComplete ? "/report" : "#processing-title"}
              onClick={(event) => {
                if (!isComplete) event.preventDefault();
              }}
            >
              Перейти к отчету
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { ProcessingPreview } from "@/components/preview/processing-preview";
import {
  isActiveJob,
  jobResponseSchema,
  workflowMessages,
  type JobView,
} from "./job-contract";

export function WorkflowProgress({
  contentItemId,
  onBack,
}: {
  contentItemId: string;
  onBack?: () => void;
}) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const retryGeneration = useRef<number | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const generation = retryGeneration.current;
    async function update(start: boolean) {
      setBusy(true);
      try {
        const response = await fetch(
          start
            ? "/api/analysis"
            : `/api/analysis?contentItemId=${encodeURIComponent(contentItemId)}`,
          {
            method: start ? "POST" : "GET",
            headers: start ? { "Content-Type": "application/json" } : undefined,
            body: start
              ? JSON.stringify({ contentItemId, retryGeneration: generation })
              : undefined,
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const value: unknown = await response.json();
        if (!response.ok) {
          const message =
            value &&
            typeof value === "object" &&
            "error" in value &&
            typeof value.error === "string"
              ? value.error
              : "Не удалось получить состояние обработки.";
          throw new Error(message);
        }
        const result = jobResponseSchema.parse(value);
        if (controller.signal.aborted) return;
        setJob(result.job);
        setError("");
        if (result.job && isActiveJob(result.job))
          timer = setTimeout(() => void update(false), 2_000);
      } catch (caught) {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Не удалось получить состояние обработки.",
          );
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void update(true);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [contentItemId, revision]);

  return (
    <ProcessingPreview
      uploadStatus="completed"
      onBack={onBack}
      uploadError={error || undefined}
      workflowMessage={
        job
          ? workflowMessages[job.status]
          : "Видео сохранено. Получаем состояние подготовки."
      }
      onRetry={
        error || job?.status === "failed" || job?.status === "cancelled"
          ? () => {
              retryGeneration.current =
                job?.status === "failed" || job?.status === "cancelled"
                  ? job.generation
                  : undefined;
              setError("");
              setRevision((current) => current + 1);
            }
          : undefined
      }
      retryDisabled={busy}
    />
  );
}

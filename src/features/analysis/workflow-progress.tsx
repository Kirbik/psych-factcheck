"use client";

import { useEffect, useRef, useState } from "react";
import { ProcessingPreview } from "@/components/preview/processing-preview";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { useVideoUpload } from "@/features/analysis/video-upload-provider";
import {
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
  const { updateWorkflowStatus } = useVideoUpload();
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const retryGeneration = useRef<number | undefined>(undefined);
  const latestJob = useRef<JobView | null>(null);
  const latestContentId = useRef(contentItemId);

  useEffect(() => {
    if (latestContentId.current !== contentItemId) {
      latestContentId.current = contentItemId;
      latestJob.current = null;
      setJob(null);
    }
    const controller = new AbortController();
    let isSubscribed = false;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    let refreshing = false;
    let realtimeReady = false;
    let supabase: ReturnType<typeof createBrowserSupabaseClient> | undefined;
    let channel:
      ReturnType<NonNullable<typeof supabase>["channel"]> | undefined;
    function applyJob(next: JobView | null) {
      if (!next) {
        latestJob.current = null;
        setJob(null);
        return;
      }
      const current = latestJob.current;
      const statusRank = {
        queued: 0,
        running: 1,
        completed: 2,
        failed: 2,
        cancelled: 2,
      } as const;
      if (
        current &&
        (next.generation < current.generation ||
          (next.generation === current.generation &&
            statusRank[next.status] < statusRank[current.status]))
      )
        return;
      latestJob.current = next;
      updateWorkflowStatus(contentItemId, next.status);
      setJob(next);
    }
    async function refreshStatus() {
      if (refreshing || controller.signal.aborted) return;
      refreshing = true;
      try {
        const response = await fetch(
          `/api/analysis?contentItemId=${encodeURIComponent(contentItemId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const value: unknown = await response.json();
        if (!response.ok) return;
        const result = jobResponseSchema.parse(value);
        applyJob(result.job);
      } catch {
        // The next realtime event or fallback tick will try again.
      } finally {
        refreshing = false;
      }
    }
    function subscribeToRealtime(config: {
      supabaseUrl: string;
      supabaseAnonKey: string;
    }) {
      if (realtimeReady) return;
      realtimeReady = true;
      supabase = createBrowserSupabaseClient(config);
      channel = supabase
        .channel(`analysis-job:${contentItemId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "analysis_jobs",
            filter: `content_item_id=eq.${contentItemId}`,
          },
          (payload) => {
            const parsed = jobResponseSchema.safeParse({ job: payload.new });
            if (!parsed.success || !parsed.data.job) return;
            applyJob(parsed.data.job);
            setError("");
          },
        )
        .subscribe((status) => {
          isSubscribed = status === "SUBSCRIBED";
          if (isSubscribed) {
            if (fallbackTimer) clearInterval(fallbackTimer);
            fallbackTimer = undefined;
            void refreshStatus();
          } else if (!fallbackTimer) {
            fallbackTimer = setInterval(() => void refreshStatus(), 10_000);
          }
        });
    }
    const generation = retryGeneration.current;
    async function update() {
      setBusy(true);
      try {
        const response = await fetch("/api/analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentItemId, retryGeneration: generation }),
          cache: "no-store",
          signal: controller.signal,
        });
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
        if (result.realtime) subscribeToRealtime(result.realtime);
        applyJob(result.job);
        setError("");
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
    void update();
    const refreshIfMissedEvent = () => {
      if (document.visibilityState !== "visible" || controller.signal.aborted)
        return;
      if (isSubscribed) void refreshStatus();
    };
    document.addEventListener("visibilitychange", refreshIfMissedEvent);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", refreshIfMissedEvent);
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [contentItemId, revision, updateWorkflowStatus]);

  return (
    <ProcessingPreview
      uploadStatus="completed"
      transcriptionStatus={
        job?.status === "completed"
          ? "completed"
          : job?.stage === "transcribe_video" && job.status === "running"
            ? "processing"
            : job?.stage === "transcribe_video" && job.status === "failed"
              ? "failed"
              : "pending"
      }
      onBack={onBack}
      uploadError={error || undefined}
      workflowMessage={
        job
          ? job.status === "running" && job.stage === "transcribe_video"
            ? "Транскрибируем видео через OpenAI."
            : job.status === "running" && job.stage === "validate_upload"
              ? "Проверяем загруженное видео."
              : workflowMessages[job.status]
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

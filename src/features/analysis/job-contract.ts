import { z } from "zod";

export const PIPELINE_VERSION = "transcription-v1";
export const ANALYSIS_WORKFLOW_NAME = "analysis-transcription-v1";
export const jobPayloadSchema = z
  .object({
    jobId: z.uuid(),
    generation: z.number().int().positive(),
  })
  .strict();
export type JobPayload = z.infer<typeof jobPayloadSchema>;

export const jobViewSchema = z.object({
  id: z.uuid(),
  generation: z.number().int().positive(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  stage: z.enum([
    "queued",
    "validate_upload",
    "screen_video",
    "transcribe_video",
    "complete",
  ]),
  attempt: z.number().int().nonnegative(),
  error_code: z.string().nullable(),
});
export type JobView = z.infer<typeof jobViewSchema>;
export const realtimeConfigSchema = z.object({
  supabaseUrl: z.url(),
  supabaseAnonKey: z.string().min(1),
});
export const jobResponseSchema = z.object({
  job: jobViewSchema.nullable(),
  realtime: realtimeConfigSchema.optional(),
});
export const isActiveJob = (job: Pick<JobView, "status">) =>
  job.status === "queued" || job.status === "running";

export const workflowMessages = {
  queued: "Видео загружено. Подготовка к анализу ожидает запуска.",
  running: "Проверяем видео и создаём транскрипт.",
  completed:
    "Транскрипт создан. Выделение утверждений и анализ пока недоступны.",
  failed:
    "Подготовка не завершена. Повторите запуск; если ошибка повторяется, загрузите видео заново.",
  cancelled: "Подготовка остановлена. Можно повторить запуск.",
} as const;

export const SCREENED_OUT_ERROR_CODE = "VIDEO_OUT_OF_SCOPE";

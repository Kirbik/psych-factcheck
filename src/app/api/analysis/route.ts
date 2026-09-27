import { z } from "zod";
import { createServerAuthClient } from "@/server/supabase/auth";
import { readBoundedJson } from "@/server/storage/bounded-json";
import { workflowRepository } from "@/server/workflows/repository";
import {
  operationalRepository,
  workflowRunner,
} from "@/server/workflows/runtime";
import { dispatchJob, reconcileJob } from "@/server/workflows/dispatch";
import { jobViewSchema } from "@/features/analysis/job-contract";

const requestSchema = z
  .object({
    contentItemId: z.uuid(),
    retryGeneration: z.number().int().positive().optional(),
  })
  .strict();

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function handle(request: Request, start: boolean) {
  if (start) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin)
      return json({ error: "Недопустимый источник запроса." }, 403);
  }
  try {
    const client = await createServerAuthClient();
    const { data, error } = await client.auth.getClaims();
    const userId = data?.claims?.sub;
    if (error || typeof userId !== "string")
      return json({ error: "Требуется войти в аккаунт." }, 401);
    const body = start
      ? await readBoundedJson(request)
      : {
          success: true,
          value: {
            contentItemId: new URL(request.url).searchParams.get(
              "contentItemId",
            ),
          },
        };
    const parsed = requestSchema.safeParse(body.success ? body.value : null);
    if (!parsed.success) return json({ error: "Некорректный запрос." }, 400);
    const { data: content, error: contentError } = await client
      .from("content_items")
      .select("id")
      .eq("id", parsed.data.contentItemId)
      .eq("user_id", userId)
      .maybeSingle();
    if (contentError) throw new Error("Content lookup failed");
    if (!content) return json({ error: "Видео не найдено." }, 404);
    const runner = workflowRunner();
    if (!runner)
      return json(
        { error: "Фоновая обработка пока не настроена. Видео сохранено." },
        503,
      );

    const userRepository = workflowRepository(client);
    let job = start
      ? await userRepository.request(content.id, parsed.data.retryGeneration)
      : await userRepository.findOwned(content.id, userId);
    if (job) {
      const repository = operationalRepository();
      // GET can recover an already-requested job, but never creates a new one.
      job = start
        ? await dispatchJob(job, repository, runner)
        : await reconcileJob(job, repository, runner);
    }
    return json({ job: job ? jobViewSchema.parse(job) : null });
  } catch {
    // Do not expose provider diagnostics, payloads, or credentials to the browser.
    return json(
      {
        error:
          "Не удалось получить состояние обработки. Повторите попытку; видео сохранено.",
      },
      503,
    );
  }
}

export const POST = (request: Request) => handle(request, true);
export const GET = (request: Request) => handle(request, false);

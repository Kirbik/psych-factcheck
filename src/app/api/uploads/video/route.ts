import { z } from "zod";
import { getPublicSupabaseConfig } from "@/lib/supabase-config";
import { contentItemsRepository } from "@/server/db/content-items-repository";
import { createServerAuthClient } from "@/server/supabase/auth";
import { readBoundedJson } from "@/server/storage/bounded-json";
import {
  validateVideoMetadata,
  VideoValidationError,
  VIDEO_BUCKET,
} from "@/server/storage/video-validator";

const requestSchema = z
  .object({
    fileName: z.string(),
    fileSizeBytes: z.number().int(),
    uploadId: z.string().uuid(),
  })
  .strict();

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  try {
    return Boolean(
      origin && new URL(origin).origin === new URL(request.url).origin,
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return jsonError("Недопустимый источник запроса.", 403);
  }

  const supabase = await createServerAuthClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId =
    typeof claimsData?.claims?.sub === "string"
      ? claimsData.claims.sub
      : undefined;
  if (claimsError || !userId) {
    return jsonError("Требуется войти в аккаунт.", 401);
  }

  const body = await readBoundedJson(request);
  if (!body.success) return jsonError("Некорректный запрос.", 400);
  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) return jsonError("Некорректные данные загрузки.", 400);

  let metadata;
  try {
    metadata = validateVideoMetadata(
      parsed.data.fileName,
      parsed.data.fileSizeBytes,
    );
  } catch (error) {
    if (error instanceof VideoValidationError) {
      return jsonError(error.message, 400);
    }
    return jsonError("Не удалось проверить видеофайл.", 400);
  }

  const { data: existing, error: existingError } =
    await contentItemsRepository.findByUploadId(
      supabase,
      userId,
      parsed.data.uploadId,
    );
  if (existingError) return jsonError("Не удалось проверить загрузку.", 500);
  if (existing) {
    return Response.json({
      contentItemId: existing.id,
      duplicate: true,
    });
  }

  const storagePath = `${userId}/${parsed.data.uploadId}${metadata.extension}`;
  const storage = supabase.storage.from(VIDEO_BUCKET);
  const { data: existingObject } = await storage.info(storagePath);
  if (existingObject) {
    return Response.json({
      duplicate: false,
      uploaded: true,
      storagePath,
    });
  }

  const publicConfig = getPublicSupabaseConfig();
  const { data: signedUpload, error: signedUploadError } =
    await storage.createSignedUploadUrl(storagePath, { upsert: false });
  if (signedUploadError || !signedUpload) {
    return jsonError("Не удалось подготовить защищённую загрузку.", 502);
  }

  return Response.json(
    {
      duplicate: false,
      fileMimeType: metadata.fileMimeType,
      storageApiKey: publicConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      storageUploadEndpoint: new URL(
        "/storage/v1/upload/resumable/sign",
        publicConfig.NEXT_PUBLIC_SUPABASE_URL,
      ).toString(),
      storagePath,
      token: signedUpload.token,
    },
    { status: 201 },
  );
}

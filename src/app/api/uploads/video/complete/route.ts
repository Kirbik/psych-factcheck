import { z } from "zod";
import { contentItemsRepository } from "@/server/db/content-items-repository";
import { createServerAuthClient } from "@/server/supabase/auth";
import { readBoundedJson } from "@/server/storage/bounded-json";
import { removeVideo } from "@/server/storage/video-storage";
import { isOwnedGeneratedVideoPath } from "@/server/storage/video-upload-path";
import {
  validateVideoBytes,
  validateVideoMetadata,
  VideoValidationError,
  VIDEO_BUCKET,
} from "@/server/storage/video-validator";

const requestSchema = z
  .object({
    fileName: z.string(),
    storagePath: z.string(),
    uploadId: z.string().uuid(),
  })
  .strict();

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  try {
    return Boolean(origin && new URL(origin).origin === new URL(request.url).origin);
  } catch {
    return false;
  }
}

async function readVideoHeader(signedUrl: string) {
  const response = await fetch(signedUrl, {
    headers: { range: "bytes=0-15" },
    cache: "no-store",
  });
  if (response.status !== 206 || !/^bytes 0-\d+\/\d+$/iu.test(response.headers.get("content-range") ?? "")) {
    await response.body?.cancel();
    throw new Error("Could not read video header");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 16) {
    throw new Error("Unexpected video header size");
  }
  return bytes;
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
  if (!parsed.success || !isOwnedGeneratedVideoPath(parsed.data.storagePath, userId)) {
    return jsonError("Объект загрузки не найден.", 404);
  }

  let requestedMetadata;
  try {
    requestedMetadata = validateVideoMetadata(parsed.data.fileName, 1);
  } catch (error) {
    if (error instanceof VideoValidationError) {
      await removeVideo(supabase, parsed.data.storagePath).catch(() => undefined);
      return jsonError(error.message, 400);
    }
    return jsonError("Не удалось проверить видеофайл.", 400);
  }
  if (!parsed.data.storagePath.endsWith(requestedMetadata.extension)) {
    await removeVideo(supabase, parsed.data.storagePath).catch(() => undefined);
    return jsonError("Тип файла не соответствует содержимому видео.", 400);
  }

  const { data: existing, error: existingError } =
    await contentItemsRepository.findByUploadId(
      supabase,
      userId,
      parsed.data.uploadId,
    );
  if (existingError) return jsonError("Не удалось проверить загрузку.", 500);
  if (existing) {
    if (existing.storage_path !== parsed.data.storagePath) {
      await removeVideo(supabase, parsed.data.storagePath).catch(() => undefined);
    }
    return Response.json({ contentItemId: existing.id, duplicate: true });
  }

  const storage = supabase.storage.from(VIDEO_BUCKET);
  const { data: objectInfo, error: infoError } = await storage.info(
    parsed.data.storagePath,
  );
  if (infoError || !objectInfo) {
    await removeVideo(supabase, parsed.data.storagePath).catch(() => undefined);
    return jsonError("Загруженный видеофайл не найден.", 400);
  }

  let metadata;
  try {
    metadata = validateVideoMetadata(
      parsed.data.fileName,
      Number(objectInfo.size),
    );
    const { data: signedObject, error: signedObjectError } =
      await storage.createSignedUrl(parsed.data.storagePath, 60);
    if (signedObjectError || !signedObject) {
      throw new Error("Could not authorize video verification");
    }
    const header = await readVideoHeader(signedObject.signedUrl);
    validateVideoBytes(header, metadata.extension);
  } catch (error) {
    await removeVideo(supabase, parsed.data.storagePath).catch(() => undefined);
    return jsonError(
      error instanceof VideoValidationError
        ? error.message
        : "Не удалось проверить загруженное видео.",
      400,
    );
  }

  let created: Awaited<ReturnType<typeof contentItemsRepository.createOwned>>;
  try {
    created = await contentItemsRepository.createOwned(supabase, userId, {
      fileMimeType: metadata.fileMimeType,
      fileSizeBytes: metadata.fileSizeBytes,
      originalFileName: metadata.fileName,
      storagePath: parsed.data.storagePath,
      uploadId: parsed.data.uploadId,
    });
  } catch {
    const retry = await contentItemsRepository.findByUploadId(
      supabase,
      userId,
      parsed.data.uploadId,
    );
    if (retry.error) {
      return jsonError("Видео загружено, но запись сохранить не удалось.", 500);
    }
    if (retry.data) {
      if (retry.data.storage_path !== parsed.data.storagePath) {
        await removeVideo(supabase, parsed.data.storagePath).catch(() => undefined);
      }
      return Response.json({ contentItemId: retry.data.id, duplicate: true });
    }
    await removeVideo(supabase, parsed.data.storagePath).catch(() => undefined);
    return jsonError("Видео загружено, но запись сохранить не удалось.", 500);
  }

  if (created.error) {
    const retry = await contentItemsRepository.findByUploadId(
      supabase,
      userId,
      parsed.data.uploadId,
    );
    if (retry.error) {
      return jsonError("Видео загружено, но запись сохранить не удалось.", 500);
    }
    if (retry.data) {
      if (retry.data.storage_path !== parsed.data.storagePath) {
        await removeVideo(supabase, parsed.data.storagePath).catch(() => undefined);
      }
      return Response.json({ contentItemId: retry.data.id, duplicate: true });
    }
    await removeVideo(supabase, parsed.data.storagePath).catch(() => undefined);
    return jsonError("Видео загружено, но запись сохранить не удалось.", 500);
  }

  return Response.json(
    { contentItemId: created.data.id, duplicate: false },
    { status: 201 },
  );
}

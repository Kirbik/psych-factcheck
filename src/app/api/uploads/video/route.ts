import { randomUUID } from "node:crypto";
import { createServerAuthClient } from "@/server/supabase/auth";
import { contentItemsRepository } from "@/server/db/content-items-repository";
import { removeVideo, uploadVideo } from "@/server/storage/video-storage";
import {
  validateVideoFile,
  VideoValidationError,
} from "@/server/storage/video-validator";
import { parseBoundedVideoForm } from "@/server/storage/multipart";
import { z } from "zod";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function findExistingUpload(
  supabase: Awaited<ReturnType<typeof createServerAuthClient>>,
  userId: string,
  uploadId: string,
) {
  try {
    return await contentItemsRepository.findByUploadId(
      supabase,
      userId,
      uploadId,
    );
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    sameOrigin = Boolean(
      origin && new URL(origin).origin === new URL(request.url).origin,
    );
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) {
    return jsonError("Недопустимый источник запроса.", 403);
  }

  const supabase = await createServerAuthClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId =
    typeof claimsData?.claims?.sub === "string"
      ? claimsData.claims.sub
      : undefined;
  if (claimsError || !userId)
    return jsonError("Требуется войти в аккаунт.", 401);

  const parsedForm = await parseBoundedVideoForm(request);
  if (!parsedForm.success) {
    return parsedForm.reason === "too-large"
      ? jsonError("Размер запроса превышает допустимый предел.", 413)
      : jsonError("Ожидается корректный multipart-запрос с видео.", 400);
  }
  const formData = parsedForm.formData;
  const videoParts = formData.getAll("video");
  const uploadParts = formData.getAll("upload_id");
  if (
    videoParts.length !== 1 ||
    uploadParts.length !== 1 ||
    [...formData.keys()].length !== 2
  ) {
    return jsonError("Отправьте ровно один видеофайл.", 400);
  }
  const [file] = videoParts;
  const [uploadId] = uploadParts;
  if (
    !(file instanceof File) ||
    typeof uploadId !== "string" ||
    !z.string().uuid().safeParse(uploadId).success
  ) {
    return jsonError("Выберите видеофайл.", 400);
  }

  const existing = await findExistingUpload(supabase, userId, uploadId);
  if (!existing || existing.error)
    return jsonError("Не удалось проверить загрузку.", 500);
  if (existing.data)
    return Response.json({ contentItemId: existing.data.id, duplicate: true });

  let metadata;
  try {
    metadata = await validateVideoFile(file);
  } catch (error) {
    if (error instanceof VideoValidationError)
      return jsonError(error.message, 400);
    return jsonError("Не удалось проверить видеофайл.", 400);
  }

  const storagePath = `${userId}/${randomUUID()}${metadata.extension}`;
  let upload: Awaited<ReturnType<typeof uploadVideo>>;
  try {
    upload = await uploadVideo(supabase, storagePath, file);
  } catch {
    await removeVideo(supabase, storagePath).catch(() => undefined);
    return jsonError("Не удалось загрузить видео.", 502);
  }
  if (upload.error) {
    await removeVideo(supabase, storagePath).catch(() => undefined);
    return jsonError("Не удалось загрузить видео.", 502);
  }

  let created: Awaited<ReturnType<typeof contentItemsRepository.createOwned>>;
  try {
    created = await contentItemsRepository.createOwned(supabase, userId, {
      fileMimeType: metadata.fileMimeType,
      fileSizeBytes: metadata.fileSizeBytes,
      originalFileName: metadata.fileName,
      storagePath,
      uploadId,
    });
  } catch {
    const retry = await findExistingUpload(supabase, userId, uploadId);
    if (!retry || retry.error) {
      return jsonError("Видео загружено, но запись сохранить не удалось.", 500);
    }
    if (retry?.data) {
      if (retry.data.storage_path !== storagePath) {
        await removeVideo(supabase, storagePath).catch(() => undefined);
      }
      return Response.json({ contentItemId: retry.data.id, duplicate: true });
    }
    await removeVideo(supabase, storagePath).catch(() => undefined);
    return jsonError("Видео загружено, но запись сохранить не удалось.", 500);
  }
  if (created.error) {
    const retry = await findExistingUpload(supabase, userId, uploadId);
    if (!retry || retry.error) {
      return jsonError("Видео загружено, но запись сохранить не удалось.", 500);
    }
    if (retry?.data) {
      if (retry.data.storage_path !== storagePath) {
        await removeVideo(supabase, storagePath).catch(() => undefined);
      }
      return Response.json({ contentItemId: retry.data.id, duplicate: true });
    }
    await removeVideo(supabase, storagePath).catch(() => undefined);
    return jsonError("Видео загружено, но запись сохранить не удалось.", 500);
  }

  return Response.json(
    { contentItemId: created.data.id, duplicate: false },
    { status: 201 },
  );
}

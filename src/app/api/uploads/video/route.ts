import { randomUUID } from "node:crypto";
import { createServerAuthClient } from "@/server/supabase/auth";
import { contentItemsRepository } from "@/server/db/content-items-repository";
import { removeVideo, uploadVideo } from "@/server/storage/video-storage";
import { validateVideoFile, VideoValidationError } from "@/server/storage/video-validator";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const supabase = await createServerAuthClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : undefined;
  if (claimsError || !userId) return jsonError("Требуется войти в аккаунт.", 401);

  const formData = await request.formData();
  const file = formData.get("video");
  const uploadId = formData.get("upload_id");
  if (!(file instanceof File) || typeof uploadId !== "string" || !/^[0-9a-f-]{36}$/iu.test(uploadId)) {
    return jsonError("Выберите видеофайл.", 400);
  }

  const existing = await contentItemsRepository.findByUploadId(supabase, userId, uploadId);
  if (existing.error) return jsonError("Не удалось проверить загрузку.", 500);
  if (existing.data) return Response.json({ contentItemId: existing.data.id, duplicate: true });

  let metadata;
  try {
    metadata = await validateVideoFile(file);
  } catch (error) {
    if (error instanceof VideoValidationError) return jsonError(error.message, 400);
    return jsonError("Не удалось проверить видеофайл.", 400);
  }

  const storagePath = `${userId}/${randomUUID()}${metadata.extension}`;
  const upload = await uploadVideo(supabase, storagePath, file);
  if (upload.error) return jsonError("Не удалось загрузить видео.", 502);

  const created = await contentItemsRepository.createOwned(supabase, userId, {
    fileMimeType: metadata.fileMimeType,
    fileSizeBytes: metadata.fileSizeBytes,
    originalFileName: metadata.fileName,
    storagePath,
    uploadId,
  });
  if (created.error) {
    await removeVideo(supabase, storagePath);
    if (created.error.code === "23505") {
      const retry = await contentItemsRepository.findByUploadId(supabase, userId, uploadId);
      if (retry.data) return Response.json({ contentItemId: retry.data.id, duplicate: true });
    }
    return jsonError("Видео загружено, но запись сохранить не удалось.", 500);
  }

  return Response.json({ contentItemId: created.data.id, duplicate: false }, { status: 201 });
}

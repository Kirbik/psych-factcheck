export type VideoUploadResponse = {
  contentItemId: string;
  duplicate: boolean;
};

const invalidUploadResponseMessage =
  "Не удалось загрузить видео. Попробуйте ещё раз.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readVideoUploadResponse(
  response: Response,
): Promise<VideoUploadResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(invalidUploadResponseMessage);
  }

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : invalidUploadResponseMessage;
    throw new Error(message);
  }

  if (
    !isRecord(body) ||
    typeof body.contentItemId !== "string" ||
    typeof body.duplicate !== "boolean"
  ) {
    throw new Error("Сервер вернул некорректный ответ. Попробуйте ещё раз.");
  }

  return {
    contentItemId: body.contentItemId,
    duplicate: body.duplicate,
  };
}

export async function uploadVideoFile(
  file: File,
  uploadId: string,
): Promise<VideoUploadResponse> {
  const formData = new FormData();
  formData.set("video", file);
  formData.set("upload_id", uploadId);

  let response: Response;
  try {
    response = await fetch("/api/uploads/video", {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error(
      "Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.",
    );
  }

  return readVideoUploadResponse(response);
}

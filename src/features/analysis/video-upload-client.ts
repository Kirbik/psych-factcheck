"use client";

import { Upload as TusUpload } from "tus-js-client";
import { getPublicSupabaseConfig } from "@/lib/supabase-config";

export type VideoUploadResult = {
  contentItemId: string;
  duplicate: boolean;
};

type UploadPreparation =
  | VideoUploadResult
  | {
      duplicate: false;
      fileMimeType: string;
      storagePath: string;
      token: string;
    };

const genericUploadError = "Не удалось загрузить видео. Попробуйте ещё раз.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readApiResponse(response: Response) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(genericUploadError);
  }
  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : genericUploadError;
    throw new Error(message);
  }
  if (!isRecord(body)) throw new Error("Сервер вернул некорректный ответ.");
  return body;
}

export async function readVideoUploadResponse(
  response: Response,
): Promise<VideoUploadResult> {
  const body = await readApiResponse(response);
  if (
    typeof body.contentItemId !== "string" ||
    typeof body.duplicate !== "boolean"
  ) {
    throw new Error("Сервер вернул некорректный ответ.");
  }
  return {
    contentItemId: body.contentItemId,
    duplicate: body.duplicate,
  };
}

async function postJson(path: string, value: unknown) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
  } catch {
    throw new Error(
      "Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.",
    );
  }
  return readApiResponse(response);
}

async function uploadWithTus(
  file: File,
  preparation: Extract<UploadPreparation, { token: string }>,
) {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } =
    getPublicSupabaseConfig();
  const endpoint = new URL(
    "/storage/v1/upload/resumable",
    NEXT_PUBLIC_SUPABASE_URL,
  ).toString();

  await new Promise<void>((resolve, reject) => {
    const upload = new TusUpload(file, {
      endpoint,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        apikey: NEXT_PUBLIC_SUPABASE_ANON_KEY,
        "x-signature": preparation.token,
      },
      metadata: {
        bucketName: "videos",
        objectName: preparation.storagePath,
        contentType: preparation.fileMimeType,
        cacheControl: "3600",
      },
      uploadDataDuringCreation: true,
      storeFingerprintForResuming: false,
      removeFingerprintOnSuccess: true,
      onError(error) {
        reject(new Error(error.message || genericUploadError));
      },
      onSuccess() {
        resolve();
      },
    });
    upload.start();
  });
}

export async function uploadVideoFile(
  file: File,
  uploadId: string,
): Promise<VideoUploadResult> {
  const preparation = await postJson("/api/uploads/video", {
    fileName: file.name,
    fileSizeBytes: file.size,
    uploadId,
  });

  if (preparation.duplicate === true) {
    if (typeof preparation.contentItemId !== "string") {
      throw new Error("Сервер вернул некорректный ответ.");
    }
    return {
      contentItemId: preparation.contentItemId,
      duplicate: true,
    };
  }

  if (
    preparation.duplicate !== false ||
    typeof preparation.storagePath !== "string" ||
    typeof preparation.token !== "string" ||
    typeof preparation.fileMimeType !== "string"
  ) {
    throw new Error("Сервер вернул некорректный ответ.");
  }

  await uploadWithTus(file, {
    duplicate: false,
    fileMimeType: preparation.fileMimeType,
    storagePath: preparation.storagePath,
    token: preparation.token,
  });

  const completed = await postJson("/api/uploads/video/complete", {
    fileName: file.name,
    storagePath: preparation.storagePath,
    uploadId,
  });
  if (
    typeof completed.contentItemId !== "string" ||
    typeof completed.duplicate !== "boolean"
  ) {
    throw new Error("Сервер вернул некорректный ответ.");
  }
  return {
    contentItemId: completed.contentItemId,
    duplicate: completed.duplicate,
  };
}

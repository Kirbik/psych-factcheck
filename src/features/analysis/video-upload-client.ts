"use client";

import { Upload as TusUpload } from "tus-js-client";
export type VideoUploadResult = {
  contentItemId: string;
  duplicate: boolean;
};

type SignedUploadPreparation = {
  duplicate: false;
  fileMimeType: string;
  storageApiKey: string;
  storageUploadEndpoint: string;
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

async function postJson(
  path: string,
  value: unknown,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
      signal,
    });
  } catch {
    if (signal?.aborted) {
      throw new DOMException("Загрузка отменена.", "AbortError");
    }
    throw new Error(
      "Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.",
    );
  }
  return readApiResponse(response);
}

async function uploadWithTus(
  file: File,
  preparation: SignedUploadPreparation,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
) {
  await new Promise<void>((resolve, reject) => {
    const upload = new TusUpload(file, {
      endpoint: preparation.storageUploadEndpoint,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        apikey: preparation.storageApiKey,
        "x-signature": preparation.token,
      },
      metadata: {
        bucketName: "videos",
        objectName: preparation.storagePath,
        contentType: preparation.fileMimeType,
        cacheControl: "3600",
      },
      uploadDataDuringCreation: true,
      fingerprint: async (uploadFile, options) =>
        [
          "psych-factcheck",
          uploadFile.name,
          uploadFile.type,
          uploadFile.size,
          uploadFile.lastModified,
          options.endpoint,
          options.metadata?.objectName,
        ].join(":"),
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      onProgress(bytesUploaded, bytesTotal) {
        if (bytesTotal > 0) {
          onProgress?.(Math.floor((bytesUploaded / bytesTotal) * 100));
        }
      },
      onError(error) {
        finish(() => reject(
          signal?.aborted
            ? new DOMException("Загрузка отменена.", "AbortError")
            : new Error(error.message || genericUploadError),
        ));
      },
      onSuccess() {
        finish(resolve);
      },
    });
    let settled = false;
    function finish(callback: () => void) {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abortUpload);
      callback();
    }
    function abortUpload() {
      void upload
        .abort(true)
        .catch(() => undefined)
        .finally(() =>
          finish(() =>
            reject(new DOMException("Загрузка отменена.", "AbortError")),
          ),
        );
    }
    signal?.addEventListener("abort", abortUpload, { once: true });
    if (signal?.aborted) {
      abortUpload();
    }
    void upload.findPreviousUploads().then((previousUploads) => {
      const previousUpload = previousUploads.find(
        (candidate) =>
          candidate.metadata.objectName === preparation.storagePath,
      );
      if (previousUpload) upload.resumeFromPreviousUpload(previousUpload);
      if (signal?.aborted) {
        if (previousUpload) abortUpload();
        return;
      }
      upload.start();
    }, (error: unknown) => finish(() => reject(error)));
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Загрузка отменена.", "AbortError");
  }
}

export async function uploadVideoFile(
  file: File,
  uploadId: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<VideoUploadResult> {
  const preparation = await postJson(
    "/api/uploads/video",
    {
      fileName: file.name,
      fileSizeBytes: file.size,
      uploadId,
    },
    signal,
  );
  throwIfAborted(signal);

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
    typeof preparation.storagePath !== "string"
  ) {
    throw new Error("Сервер вернул некорректный ответ.");
  }

  if (preparation.uploaded !== true) {
    if (
      typeof preparation.storageApiKey !== "string" ||
      typeof preparation.storageUploadEndpoint !== "string" ||
      typeof preparation.token !== "string" ||
      typeof preparation.fileMimeType !== "string"
    ) {
      throw new Error("Сервер вернул некорректный ответ.");
    }

    await uploadWithTus(
      file,
      {
        duplicate: false,
        fileMimeType: preparation.fileMimeType,
        storageApiKey: preparation.storageApiKey,
        storageUploadEndpoint: preparation.storageUploadEndpoint,
        storagePath: preparation.storagePath,
        token: preparation.token,
      },
      onProgress,
      signal,
    );
  }

  throwIfAborted(signal);
  const completed = await postJson(
    "/api/uploads/video/complete",
    {
      fileName: file.name,
      storagePath: preparation.storagePath,
      uploadId,
    },
    signal,
  );
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

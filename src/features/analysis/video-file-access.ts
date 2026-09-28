"use client";

const databaseName = "psych-factcheck-file-handles";
const storeName = "uploads";
const handleTtlMs = 24 * 60 * 60 * 1000;

type PersistentFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  queryPermission(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" }): Promise<PermissionState>;
};

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple: false;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle[]>;
};

function openHandleDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName, { keyPath: "uploadId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function supportsPersistentVideoAccess() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof indexedDB !== "undefined" &&
    typeof (window as FilePickerWindow).showOpenFilePicker === "function"
  );
}

export async function pickVideoFileWithHandle(): Promise<{
  file: File;
  handle: FileSystemFileHandle;
} | null> {
  const picker = (window as FilePickerWindow).showOpenFilePicker;
  if (!picker) return null;
  try {
    const [handle] = await picker.call(window, {
      multiple: false,
      types: [
        {
          description: "Видео",
          accept: {
            "video/mp4": [".mp4"],
            "video/webm": [".webm"],
            "video/quicktime": [".mov"],
          },
        },
      ],
    });
    return handle ? { file: await handle.getFile(), handle } : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

export async function saveVideoFileHandle(
  uploadId: string,
  handle: FileSystemFileHandle,
) {
  const database = await openHandleDatabase();
  if (!database) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const transaction = database.transaction(storeName, "readwrite");
      transaction
        .objectStore(storeName)
        .put({ uploadId, handle, savedAt: Date.now() });
      transaction.oncomplete = () => {
        database.close();
        resolve(true);
      };
      transaction.onerror = transaction.onabort = () => {
        database.close();
        resolve(false);
      };
    } catch {
      database.close();
      resolve(false);
    }
  });
}

export async function getVideoFileFromHandle(uploadId: string) {
  const database = await openHandleDatabase();
  if (!database) return null;
  const stored = await new Promise<unknown>((resolve) => {
    try {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(uploadId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
      transaction.oncomplete = () => database.close();
    } catch {
      database.close();
      resolve(null);
    }
  });
  if (
    typeof stored === "object" &&
    stored !== null &&
    "savedAt" in stored &&
    typeof stored.savedAt === "number" &&
    Date.now() - stored.savedAt > handleTtlMs
  ) {
    await deleteVideoFileHandle(uploadId);
    return null;
  }
  if (
    typeof stored !== "object" ||
    stored === null ||
    !("handle" in stored) ||
    typeof stored.handle !== "object" ||
    stored.handle === null ||
    !("kind" in stored.handle) ||
    stored.handle.kind !== "file" ||
    !("getFile" in stored.handle) ||
    typeof stored.handle.getFile !== "function" ||
    !("queryPermission" in stored.handle) ||
    typeof stored.handle.queryPermission !== "function" ||
    !("requestPermission" in stored.handle) ||
    typeof stored.handle.requestPermission !== "function"
  ) {
    return null;
  }
  const handle = stored.handle as PersistentFileHandle;
  try {
    let permission = await handle.queryPermission({ mode: "read" });
    if (permission !== "granted") {
      permission = await handle.requestPermission({ mode: "read" });
    }
    return permission === "granted" ? await handle.getFile() : null;
  } catch {
    return null;
  }
}

export async function deleteVideoFileHandle(uploadId: string) {
  const database = await openHandleDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(uploadId);
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => {
        database.close();
        resolve();
      };
    } catch {
      database.close();
      resolve();
    }
  });
}

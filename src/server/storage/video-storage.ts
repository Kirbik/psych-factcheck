import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { VIDEO_BUCKET } from "@/server/storage/video-validator";

type StorageClient = SupabaseClient<Database>;

export async function uploadVideo(client: StorageClient, path: string, file: File) {
  return client.storage.from(VIDEO_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
}

export async function removeVideo(client: StorageClient, path: string) {
  return client.storage.from(VIDEO_BUCKET).remove([path]);
}

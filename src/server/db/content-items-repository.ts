import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type ContentItemClient = SupabaseClient<Database>;

/** Minimal user-context repository; the explicit owner filter complements RLS. */
export const contentItemsRepository = {
  listOwned(client: ContentItemClient, userId: string) {
    return client.from("content_items").select().eq("user_id", userId);
  },

  findByUploadId(client: ContentItemClient, userId: string, uploadId: string) {
    return client
      .from("content_items")
      .select()
      .eq("user_id", userId)
      .eq("upload_id", uploadId)
      .maybeSingle();
  },

  createOwned(
    client: ContentItemClient,
    userId: string,
    values: {
      fileMimeType: string;
      fileSizeBytes: number;
      originalFileName: string;
      storagePath: string;
      uploadId: string;
    },
  ) {
    return client
      .from("content_items")
      .insert({
        user_id: userId,
        file_mime_type: values.fileMimeType,
        file_size_bytes: values.fileSizeBytes,
        original_file_name: values.originalFileName,
        storage_path: values.storagePath,
        upload_id: values.uploadId,
      })
      .select()
      .single();
  },
};

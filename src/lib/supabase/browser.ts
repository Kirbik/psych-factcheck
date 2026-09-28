"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/** Uses public config supplied by the authenticated server at runtime. */
export function createBrowserSupabaseClient(config: {
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  return createBrowserClient<Database>(
    config.supabaseUrl,
    config.supabaseAnonKey,
  );
}

"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseConfig } from "@/lib/supabase-config";
import type { Database } from "@/types/database";

/** Browser-safe client: it contains only the public URL and anonymous key. */
export function createBrowserSupabaseClient() {
  const config = getPublicSupabaseConfig();

  return createBrowserClient<Database>(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/supabase-config";
import type { Database } from "@/types/database";

/**
 * Server client for an authenticated user's bearer token. It deliberately uses
 * the anonymous key so every query remains subject to the user's RLS policies.
 */
export function createServerSupabaseClient(accessToken: string) {
  const config = getPublicSupabaseConfig();

  return createClient<Database>(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
}

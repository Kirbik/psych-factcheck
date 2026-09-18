import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getServerSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Privileged server-only client. Do not use for user-owned requests: service
 * role bypasses RLS and is reserved for trusted operational work.
 */
export function createAdminSupabaseClient() {
  const config = getServerSupabaseConfig();

  return createClient<Database>(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

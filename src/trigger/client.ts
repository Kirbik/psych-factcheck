import { env } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";

// Standalone Node worker boundary. Do not import Next's `server-only` marker here:
// that package intentionally throws outside the React server module condition.
export function createWorkerClient() {
  const config = z
    .object({
      SUPABASE_URL: z.url(),
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    })
    .parse(env);
  return createClient<Database>(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (url, init) =>
          fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }),
      },
    },
  );
}

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";

export function createWorkerClient(environment: Record<string, unknown>) {
  const config = z
    .object({
      SUPABASE_URL: z.url().optional(),
      NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    })
    .parse(environment);
  const supabaseUrl =
    config.SUPABASE_URL ?? config.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Supabase URL unavailable");
  return createClient<Database>(
    supabaseUrl,
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

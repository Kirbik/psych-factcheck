import "server-only";

import { z } from "zod";
import { getPublicSupabaseConfig } from "@/lib/supabase-config";

const serverSupabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type ServerSupabaseConfig = z.infer<typeof serverSupabaseSchema>;

/** Validates the service-role secret only in server-only administrative code. */
export function getServerSupabaseConfig(): ServerSupabaseConfig {
  return serverSupabaseSchema.parse({
    ...getPublicSupabaseConfig(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

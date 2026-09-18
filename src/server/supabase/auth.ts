import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseConfig } from "@/lib/supabase-config";
import type { Database } from "@/types/database";

/**
 * Per-request cookie client for Server Components and Server Actions.
 * Session refreshes are persisted by src/proxy.ts before protected pages render.
 */
export async function createServerAuthClient() {
  const config = getPublicSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot modify response cookies. The proxy
            // refreshes sessions before protected pages are rendered.
          }
        },
      },
    },
  );
}

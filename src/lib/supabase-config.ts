import { z } from "zod";

const publicSupabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type PublicSupabaseConfig = z.infer<typeof publicSupabaseSchema>;

/** Validates public configuration only when a Supabase client is requested. */
export function getPublicSupabaseConfig(): PublicSupabaseConfig {
  return publicSupabaseSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

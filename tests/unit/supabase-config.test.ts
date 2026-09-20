import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicSupabaseConfig } from "@/lib/supabase-config";

describe("Supabase public configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the current publishable key name", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

    expect(getPublicSupabaseConfig()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
    });
  });
});

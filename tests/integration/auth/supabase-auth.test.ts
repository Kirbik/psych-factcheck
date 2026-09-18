import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/types/database";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const describeAuth = url && key ? describe : describe.skip;

describeAuth("Supabase Auth and profile lifecycle", () => {
  it("creates a session-backed user whose profile is readable only while signed in", async () => {
    const supabase = createClient<Database>(url!, key!);
    const email = `session-3-${randomUUID()}@auth.test`;
    const password = "session-3-test-password";

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    expect(signUpError).toBeNull();
    expect(signUpData.user?.id).toBeDefined();
    expect(signUpData.session).not.toBeNull();

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", signUpData.user!.id)
      .single();
    expect(profileError).toBeNull();
    expect(profile?.id).toBe(signUpData.user!.id);

    const { error: signOutError } = await supabase.auth.signOut();
    expect(signOutError).toBeNull();

    const { data: signedOutProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", signUpData.user!.id);
    expect(signedOutProfile).toEqual([]);
  });
});

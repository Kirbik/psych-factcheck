import "server-only";

import { redirect } from "next/navigation";
import { createServerAuthClient } from "@/server/supabase/auth";

export async function redirectAuthenticatedUser() {
  let hasVerifiedSession = false;

  try {
    const supabase = await createServerAuthClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims as Record<string, unknown> | undefined;
    hasVerifiedSession = !error && typeof claims?.sub === "string";
  } catch {
    // Keep auth entry points available if Supabase cannot verify a session.
    return;
  }

  if (hasVerifiedSession) {
    redirect("/ui-preview/history");
  }
}

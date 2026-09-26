import "server-only";

import { createAdminSupabaseClient } from "@/server/supabase/admin";
import { createServerAuthClient } from "@/server/supabase/auth";

const invalidTokenMessage = "Токен авторизации не найден или недействителен";

export class InvalidAccessTokenError extends Error {
  constructor() {
    super(invalidTokenMessage);
    this.name = "InvalidAccessTokenError";
  }
}

function generateAccessToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `pfc_${value}`;
}

async function hashAccessToken(token: string) {
  const encodedToken = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", encodedToken);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function createInternalEmail() {
  return `account-${crypto.randomUUID()}@users.invalid`;
}

/** Creates a Supabase Auth identity and returns its access token exactly once. */
export async function registerAccessTokenAccount() {
  const admin = createAdminSupabaseClient();
  const token = generateAccessToken();
  const email = createInternalEmail();
  let createdUserId: string | undefined;

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: token,
    });

    if (error || !data.user) {
      throw error ?? new Error("Supabase did not return the created user");
    }

    createdUserId = data.user.id;
    const tokenHash = await hashAccessToken(token);
    const { error: tokenError } = await admin
      .from("auth_access_tokens")
      .insert({ user_id: createdUserId, token_hash: tokenHash });

    if (tokenError) {
      throw tokenError;
    }

    const auth = await createServerAuthClient();
    const { error: sessionError } = await auth.auth.signInWithPassword({
      email,
      password: token,
    });

    if (sessionError) {
      throw sessionError;
    }

    return token;
  } catch (error) {
    if (createdUserId) {
      const { error: cleanupError } =
        await admin.auth.admin.deleteUser(createdUserId);
      if (cleanupError) {
        console.error("[auth] Failed to clean up incomplete token account", {
          code: cleanupError.code,
          status: cleanupError.status,
        });
      }
    }
    throw error;
  }
}

/** Finds a token account by its digest, then creates a normal Supabase cookie session. */
export async function authenticateWithAccessToken(token: string) {
  const admin = createAdminSupabaseClient();
  const tokenHash = await hashAccessToken(token);
  const { data: tokenRecord, error: tokenLookupError } = await admin
    .from("auth_access_tokens")
    .select("user_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (tokenLookupError) {
    throw tokenLookupError;
  }

  if (!tokenRecord) {
    throw new InvalidAccessTokenError();
  }

  const { data, error: userLookupError } = await admin.auth.admin.getUserById(
    tokenRecord.user_id,
  );
  const email = data.user?.email;

  if (userLookupError || !email) {
    if (userLookupError) {
      throw userLookupError;
    }
    throw new InvalidAccessTokenError();
  }

  const auth = await createServerAuthClient();
  const { error: signInError } = await auth.auth.signInWithPassword({
    email,
    password: token,
  });

  if (signInError) {
    throw new InvalidAccessTokenError();
  }
}

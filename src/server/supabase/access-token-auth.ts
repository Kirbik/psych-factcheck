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

export class InvalidRegistrationTokenError extends Error {
  constructor() {
    super("Registration token is missing, expired, or already used");
    this.name = "InvalidRegistrationTokenError";
  }
}

function generateSecret(prefix: "pfc" | "pfr") {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${prefix}_${value}`;
}

async function hashSecret(secret: string) {
  const encodedSecret = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", encodedSecret);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function createInternalEmail() {
  return `account-${crypto.randomUUID()}@users.invalid`;
}

/** Generates an access token and temporarily stores only its digest. */
export async function createPendingRegistrationToken() {
  const admin = createAdminSupabaseClient();
  const token = generateSecret("pfc");
  const tokenHash = await hashSecret(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { error: cleanupError } = await admin
    .from("auth_pending_access_tokens")
    .delete()
    .lt("expires_at", now.toISOString());
  if (cleanupError) {
    throw cleanupError;
  }

  const { error } = await admin.from("auth_pending_access_tokens").insert({
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (error) {
    throw error;
  }

  return token;
}

/** Consumes a pending token and creates a Supabase Auth identity exactly once. */
export async function registerAccessTokenAccount(token: string) {
  const admin = createAdminSupabaseClient();
  const tokenHash = await hashSecret(token);
  const recoveryCode = generateSecret("pfr");
  const recoveryCodeHash = await hashSecret(recoveryCode);
  const { data: pendingToken, error: pendingTokenError } = await admin
    .from("auth_pending_access_tokens")
    .delete()
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .select("expires_at")
    .maybeSingle();

  if (pendingTokenError) {
    throw pendingTokenError;
  }
  if (!pendingToken) {
    throw new InvalidRegistrationTokenError();
  }

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
    const { error: tokenError } = await admin
      .from("auth_access_tokens")
      .insert({ user_id: createdUserId, token_hash: tokenHash });

    if (tokenError) {
      throw tokenError;
    }

    const { error: recoveryCodeError } = await admin
      .from("auth_recovery_codes")
      .insert({ user_id: createdUserId, code_hash: recoveryCodeHash });

    if (recoveryCodeError) {
      throw recoveryCodeError;
    }

    return recoveryCode;
  } catch (error) {
    let canRestorePendingToken = true;
    if (createdUserId) {
      const { error: cleanupError } =
        await admin.auth.admin.deleteUser(createdUserId);
      if (cleanupError) {
        canRestorePendingToken = false;
        console.error("[auth] Failed to clean up incomplete token account", {
          code: cleanupError.code,
        });
      }
    }
    if (canRestorePendingToken) {
      const { error: restoreError } = await admin
        .from("auth_pending_access_tokens")
        .insert({ token_hash: tokenHash, expires_at: pendingToken.expires_at });
      if (restoreError) {
        console.error("[auth] Failed to restore pending registration token", {
          code: restoreError.code,
        });
      }
    }
    throw error;
  }
}

/** Finds a token account by its digest, then creates a normal Supabase cookie session. */
export async function authenticateWithAccessToken(token: string) {
  const admin = createAdminSupabaseClient();
  const tokenHash = await hashSecret(token);
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

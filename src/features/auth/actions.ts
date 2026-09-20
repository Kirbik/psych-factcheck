"use server";

import { redirect } from "next/navigation";
import { genericAuthError, toSafeAuthError } from "@/features/auth/errors";
import type { AuthActionState } from "@/features/auth/state";
import {
  parseAuthCredentials,
  parseSignUpCredentials,
} from "@/features/auth/validation";
import { createServerAuthClient } from "@/server/supabase/auth";

async function tryAuthRequest<T>(
  request: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await request() };
  } catch {
    return { ok: false };
  }
}

function validationState(
  parsed:
    | ReturnType<typeof parseAuthCredentials>
    | ReturnType<typeof parseSignUpCredentials>,
): AuthActionState | undefined {
  if (parsed.success) {
    return undefined;
  }

  return {
    message: "Проверьте введённые данные",
    fieldErrors: parsed.error.flatten().fieldErrors,
  };
}

export async function signUp(
  _: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const credentials = parseSignUpCredentials(formData);
  if (!credentials.success) {
    return validationState(credentials) ?? {
      message: "Проверьте введённые данные",
    };
  }

  const { email, password } = credentials.data;
  const result = await tryAuthRequest(async () => {
    const supabase = await createServerAuthClient();
    return supabase.auth.signUp({ email, password });
  });
  if (!result.ok) {
    return { message: genericAuthError };
  }

  const { data, error } = result.value;
  if (error) {
    return { message: toSafeAuthError(error.message) };
  }

  if (data.session) {
    redirect("/dashboard");
  }

  return {
    message: "Проверьте почту, чтобы подтвердить регистрацию и войти.",
  };
}

export async function signIn(
  _: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const credentials = parseAuthCredentials(formData);
  if (!credentials.success) {
    return validationState(credentials) ?? {
      message: "Проверьте введённые данные",
    };
  }

  const result = await tryAuthRequest(async () => {
    const supabase = await createServerAuthClient();
    return supabase.auth.signInWithPassword(credentials.data);
  });
  if (!result.ok) {
    return { message: genericAuthError };
  }

  const { error } = result.value;
  if (error) {
    return { message: toSafeAuthError(error.message) };
  }

  redirect("/dashboard");
}

export async function signOut() {
  const result = await tryAuthRequest(async () => {
    const supabase = await createServerAuthClient();
    return supabase.auth.signOut();
  });

  if (!result.ok || result.value.error) {
    redirect("/login?logout=failed");
  }

  redirect("/login?logout=success");
}

"use server";

import { redirect } from "next/navigation";
import {
  authConfigurationError,
  authServiceError,
  toSafeAuthError,
} from "@/features/auth/errors";
import type { AuthActionState } from "@/features/auth/state";
import {
  parseAuthCredentials,
  parseSignUpCredentials,
} from "@/features/auth/validation";
import { createServerAuthClient } from "@/server/supabase/auth";

async function tryAuthRequest<T>(
  request: () => Promise<T>,
  operation: "sign-in" | "sign-up" | "sign-out",
): Promise<
  | { ok: true; value: T }
  | { ok: false; errorName: string }
> {
  try {
    return { ok: true, value: await request() };
  } catch (error) {
    const details = getAuthErrorDetails(error);
    console.error("[auth] Supabase request failed", {
      operation,
      ...details,
    });
    return { ok: false, errorName: details.name };
  }
}

function getAuthErrorDetails(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return { name: "UnknownError" };
  }

  const candidate = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
  };

  return {
    name: typeof candidate.name === "string" ? candidate.name : "UnknownError",
    ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
    ...(typeof candidate.status === "number" ? { status: candidate.status } : {}),
  };
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
  }, "sign-up");
  if (!result.ok) {
    return {
      message:
        result.errorName === "ZodError"
          ? authConfigurationError
          : authServiceError,
    };
  }

  const { data, error } = result.value;
  if (error) {
    return { message: toSafeAuthError(error.message, error.code) };
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
  }, "sign-in");
  if (!result.ok) {
    return {
      message:
        result.errorName === "ZodError"
          ? authConfigurationError
          : authServiceError,
    };
  }

  const { error } = result.value;
  if (error) {
    return {
      message: toSafeAuthError(error.message, error.code, error.status),
    };
  }

  redirect("/dashboard");
}

export async function signOut() {
  const result = await tryAuthRequest(async () => {
    const supabase = await createServerAuthClient();
    return supabase.auth.signOut();
  }, "sign-out");

  if (!result.ok || result.value.error) {
    redirect("/login?logout=failed");
  }

  redirect("/login?logout=success");
}

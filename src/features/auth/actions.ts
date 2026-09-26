"use server";

import { redirect } from "next/navigation";
import {
  authConfigurationError,
  authServiceError,
} from "@/features/auth/errors";
import type { AuthActionState } from "@/features/auth/state";
import { parseSignIn, parseSignUp } from "@/features/auth/validation";
import {
  authenticateWithAccessToken,
  InvalidAccessTokenError,
  InvalidRegistrationTokenError,
  createPendingRegistrationToken,
  registerAccessTokenAccount,
} from "@/server/supabase/access-token-auth";
import { createServerAuthClient } from "@/server/supabase/auth";

function getSafeErrorDetails(error: unknown) {
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
    ...(typeof candidate.status === "number"
      ? { status: candidate.status }
      : {}),
  };
}

function safeFailure(
  error: unknown,
  operation: "generate-token" | "register" | "sign-in",
) {
  const details = getSafeErrorDetails(error);
  console.error("[auth] Token authentication failed", {
    operation,
    ...details,
  });

  if (error instanceof InvalidAccessTokenError) {
    return { message: "Токен авторизации введён неверно" };
  }
  if (error instanceof InvalidRegistrationTokenError) {
    return {
      fieldErrors: {
        token: [
          "Токен регистрации истёк или уже использован. Сгенерируйте новый.",
        ],
      },
    };
  }

  return {
    message:
      details.name === "ZodError" ? authConfigurationError : authServiceError,
  };
}

export async function generateRegistrationToken(
  previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  void previousState;
  void formData;
  try {
    const generatedToken = await createPendingRegistrationToken();
    return {
      generatedToken,
      message: "Сохраните токен: повторно показать его будет невозможно.",
    };
  } catch (error) {
    return safeFailure(error, "generate-token");
  }
}

export async function registerWithToken(
  _: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = parseSignUp(formData);
  if (!parsed.success) {
    return {
      message: "Проверьте введённые данные",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await registerAccessTokenAccount(parsed.data.token);
    return {
      registrationComplete: true,
      message: "Регистрация завершена. Сохраните токен для следующих входов.",
    };
  } catch (error) {
    return safeFailure(error, "register");
  }
}

export async function signInWithToken(
  _: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = parseSignIn(formData);
  if (!parsed.success) {
    return {
      message: "Проверьте введённый токен",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await authenticateWithAccessToken(parsed.data.token);
  } catch (error) {
    return safeFailure(error, "sign-in");
  }

  redirect("/ui-preview/history");
}

export async function signOut() {
  try {
    const supabase = await createServerAuthClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
  } catch (error) {
    const details = getSafeErrorDetails(error);
    console.error("[auth] Sign-out failed", details);
    redirect("/login?logout=failed");
  }

  redirect("/login?logout=success");
}

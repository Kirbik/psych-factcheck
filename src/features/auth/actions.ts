"use server";

import { redirect } from "next/navigation";
import { toSafeAuthError } from "@/features/auth/errors";
import type { AuthActionState } from "@/features/auth/state";
import {
  parseAuthCredentials,
  parseSignUpCredentials,
} from "@/features/auth/validation";
import { createServerAuthClient } from "@/server/supabase/auth";

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

  const supabase = await createServerAuthClient();
  const { email, password } = credentials.data;
  const { data, error } = await supabase.auth.signUp({ email, password });
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

  const supabase = await createServerAuthClient();
  const { error } = await supabase.auth.signInWithPassword(credentials.data);
  if (error) {
    return { message: toSafeAuthError(error.message) };
  }

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createServerAuthClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    redirect("/login?logout=failed");
  }

  redirect("/login?logout=success");
}

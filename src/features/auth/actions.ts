"use server";

import { redirect } from "next/navigation";
import { toSafeAuthError } from "@/features/auth/errors";
import type { AuthActionState } from "@/features/auth/state";
import { parseAuthCredentials } from "@/features/auth/validation";
import { createServerAuthClient } from "@/server/supabase/auth";

function validationState(formData: FormData): AuthActionState | undefined {
  const parsed = parseAuthCredentials(formData);
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
  const invalid = validationState(formData);
  if (invalid) {
    return invalid;
  }

  const credentials = parseAuthCredentials(formData);
  if (!credentials.success) {
    return { message: "Проверьте введённые данные" };
  }

  const supabase = await createServerAuthClient();
  const { data, error } = await supabase.auth.signUp(credentials.data);
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
  const invalid = validationState(formData);
  if (invalid) {
    return invalid;
  }

  const credentials = parseAuthCredentials(formData);
  if (!credentials.success) {
    return { message: "Проверьте введённые данные" };
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

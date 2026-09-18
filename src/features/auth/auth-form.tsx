"use client";

import { useActionState } from "react";
import type { AuthActionState } from "@/features/auth/state";
import { initialAuthActionState } from "@/features/auth/state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthFormProps = {
  action: (
    state: AuthActionState,
    formData: FormData,
  ) => Promise<AuthActionState>;
  submitLabel: string;
};

export function AuthForm({ action, submitLabel }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    initialAuthActionState,
  );

  return (
    <form action={formAction} className="auth-form" noValidate>
      <Label htmlFor="email">Эл. почта</Label>
      <Input
        aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
        autoComplete="email"
        id="email"
        name="email"
        required
        type="email"
      />
      {state.fieldErrors?.email ? (
        <p id="email-error" role="alert">
          {state.fieldErrors.email[0]}
        </p>
      ) : null}

      <Label htmlFor="password">Пароль</Label>
      <Input
        aria-describedby={
          state.fieldErrors?.password ? "password-error" : undefined
        }
        autoComplete={submitLabel === "Войти" ? "current-password" : "new-password"}
        id="password"
        name="password"
        required
        type="password"
      />
      {state.fieldErrors?.password ? (
        <p id="password-error" role="alert">
          {state.fieldErrors.password[0]}
        </p>
      ) : null}

      {state.message ? <p role="alert">{state.message}</p> : null}
      <Button loading={pending} type="submit">
        {pending ? "Пожалуйста, подождите…" : submitLabel}
      </Button>
    </form>
  );
}

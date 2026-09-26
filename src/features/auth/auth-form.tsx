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
  const isSignup = submitLabel === "Зарегистрироваться";

  return (
    <form action={formAction} className="auth-form" noValidate>
      <Label htmlFor="email">Эл. почта</Label>
      <Input
        aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
        aria-invalid={state.fieldErrors?.email ? true : undefined}
        autoComplete="email"
        id="email"
        name="email"
        required
        type="email"
      />
      {state.fieldErrors?.email ? (
        <p className="validation-error" id="email-error" role="alert">
          {state.fieldErrors.email[0]}
        </p>
      ) : null}

      <Label htmlFor="password">Пароль</Label>
      <Input
        aria-describedby={
          state.fieldErrors?.password ? "password-error" : undefined
        }
        aria-invalid={state.fieldErrors?.password ? true : undefined}
        autoComplete={submitLabel === "Войти" ? "current-password" : "new-password"}
        id="password"
        name="password"
        required
        type="password"
      />
      {state.fieldErrors?.password ? (
        <p className="validation-error" id="password-error" role="alert">
          {state.fieldErrors.password[0]}
        </p>
      ) : null}

      {isSignup ? (
        <>
          <Label htmlFor="password-repeat">Повторите пароль</Label>
          <Input
            aria-describedby={
              state.fieldErrors?.passwordRepeat
                ? "password-repeat-error"
                : undefined
            }
            aria-invalid={state.fieldErrors?.passwordRepeat ? true : undefined}
            autoComplete="new-password"
            id="password-repeat"
            name="passwordRepeat"
            required
            type="password"
          />
          {state.fieldErrors?.passwordRepeat ? (
            <p className="validation-error" id="password-repeat-error" role="alert">
              {state.fieldErrors.passwordRepeat[0]}
            </p>
          ) : null}
        </>
      ) : null}

      {state.message ? <p className="validation-error validation-error--summary" role="alert">{state.message}</p> : null}
      <Button loading={pending} type="submit">
        {pending ? "Пожалуйста, подождите…" : submitLabel}
      </Button>
    </form>
  );
}

"use client";

import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import { useActionState, useEffect, useState } from "react";
import type { AuthActionState } from "@/features/auth/state";
import { initialAuthActionState } from "@/features/auth/state";
import styles from "./auth-preview.module.css";

type AuthPreviewMode = "login" | "signup" | "reset";

type AuthPreviewProps = {
  actions?: AuthPreviewActions;
  mode: AuthPreviewMode;
};

type AuthPreviewAction = (
  state: AuthActionState,
  formData: FormData,
) => Promise<AuthActionState>;

type AuthPreviewFormValues = {
  email: string;
  password: string;
  passwordRepeat: string;
  remember: boolean;
};

type AuthPreviewTextField = "email" | "password" | "passwordRepeat";

type AuthPreviewActions = {
  login: AuthPreviewAction;
  signup: AuthPreviewAction;
};

async function previewAction(): Promise<AuthActionState> {
  return {};
}

const inter = Inter({
  display: "swap",
  subsets: ["cyrillic", "latin"],
  variable: "--auth-preview-inter",
  weight: ["400", "500", "600"],
});

const lora = Lora({
  display: "swap",
  subsets: ["cyrillic", "latin"],
  variable: "--auth-preview-lora",
  weight: ["600"],
});

const copy: Record<
  AuthPreviewMode,
  { title: string; description: string; submit: string }
> = {
  login: {
    title: "С возвращением",
    description:
      "Войдите, чтобы продолжить проверять утверждения и смотреть свои отчёты.",
    submit: "Войти",
  },
  signup: {
    title: "Создайте аккаунт",
    description:
      "Сохраняйте приватные проверки и возвращайтесь к отчётам в любое время.",
    submit: "Создать аккаунт",
  },
  reset: {
    title: "Восстановить пароль",
    description:
      "Укажите почту — мы отправим ссылку для восстановления доступа.",
    submit: "Отправить ссылку",
  },
};

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m5 12 4 4 10-10" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function AuthPreview({ actions, mode }: AuthPreviewProps) {
  const [activeMode, setActiveMode] = useState(mode);
  const [formValues, setFormValues] = useState<Record<AuthPreviewMode, AuthPreviewFormValues>>(() => ({
    login: { email: "", password: "", passwordRepeat: "", remember: true },
    signup: { email: "", password: "", passwordRepeat: "", remember: true },
    reset: { email: "", password: "", passwordRepeat: "", remember: true },
  }));

  useEffect(() => {
    const handlePopState = () => {
      const nextMode = new URLSearchParams(window.location.search).get("mode");
      setActiveMode(nextMode === "signup" || nextMode === "reset" ? nextMode : "login");
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateMode = (nextMode: AuthPreviewMode) => {
    const href = nextMode === "login" ? "/" : `/?mode=${nextMode}`;
    window.history.pushState(null, "", href);
    setActiveMode(nextMode);
  };

  const updateTextValue = (
    formMode: AuthPreviewMode,
    field: AuthPreviewTextField,
    value: string,
  ) => {
    setFormValues((current) => ({
      ...current,
      [formMode]: { ...current[formMode], [field]: value },
    }));
  };

  const updateRememberValue = (formMode: AuthPreviewMode, value: boolean) => {
    setFormValues((current) => ({
      ...current,
      [formMode]: { ...current[formMode], remember: value },
    }));
  };

  return (
    <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Псих Фактчек — вход">
          <span className={styles.mark}><CheckIcon /></span>
          <span>Псих Фактчек</span>
        </Link>
        <nav className={styles.nav} aria-label="Навигация макета">
          <a href="#how">Как это работает</a>
          <a href="#about">О сервисе</a>
          <a href="#sources">Источники</a>
          <Link
            className={styles.signIn}
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigateMode("login");
            }}
          >
            Войти
          </Link>
        </nav>
      </header>

      <section className={styles.stage} aria-labelledby="auth-preview-title">
        <AuthPreviewForm
          action={activeMode === "reset" ? undefined : actions?.[activeMode]}
          key={activeMode}
          mode={activeMode}
          onModeChange={navigateMode}
          onRememberChange={(value) => updateRememberValue(activeMode, value)}
          onTextChange={(field, value) => updateTextValue(activeMode, field, value)}
          values={formValues[activeMode]}
        />
      </section>
    </main>
  );
}

type AuthPreviewFormProps = {
  action?: AuthPreviewAction;
  mode: AuthPreviewMode;
  onModeChange: (mode: AuthPreviewMode) => void;
  onRememberChange: (value: boolean) => void;
  onTextChange: (field: AuthPreviewTextField, value: string) => void;
  values: AuthPreviewFormValues;
};

function AuthPreviewForm({
  action,
  mode,
  onModeChange,
  onRememberChange,
  onTextChange,
  values,
}: AuthPreviewFormProps) {
  const [authState, formAction, pending] = useActionState(
    action ?? previewAction,
    initialAuthActionState,
  );
  const screen = copy[mode];
  const isReset = mode === "reset";
  const emailError = authState.fieldErrors?.email?.[0];
  const passwordError = authState.fieldErrors?.password?.[0];
  const passwordRepeatError = authState.fieldErrors?.passwordRepeat?.[0];
  const hasFieldErrors = Boolean(emailError || passwordError || passwordRepeatError);

  return (
    <form
      autoComplete="off"
      action={formAction}
      aria-label={mode === "signup" ? "Регистрация" : mode === "reset" ? "Восстановление пароля" : "Авторизация"}
      className={`${styles.card} ${isReset ? styles.resetCard : ""}`}
      noValidate
      onSubmit={action ? undefined : (event) => event.preventDefault()}
      onReset={(event) => event.preventDefault()}
    >
      {mode !== "reset" ? (
        <div className={styles.tabs} role="tablist" aria-label="Способ доступа">
          <Link
            aria-selected={mode === "login"}
            className={mode === "login" ? styles.tabActive : styles.tab}
            href="/"
            onClick={(event) => {
              event.preventDefault();
              onModeChange("login");
            }}
            role="tab"
          >
            Войти
          </Link>
          <Link
            aria-selected={mode === "signup"}
            className={mode === "signup" ? styles.tabActive : styles.tab}
            href="/?mode=signup"
            onClick={(event) => {
              event.preventDefault();
              onModeChange("signup");
            }}
            role="tab"
          >
            Регистрация
          </Link>
        </div>
      ) : null}
      <h1 id="auth-preview-title">{screen.title}</h1>
      <p className={styles.description}>{screen.description}</p>

      <label className={styles.fieldLabel} htmlFor="preview-email">
        Электронная почта
      </label>
      <div className={styles.fieldWrap}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7 7.5 5.7L19.5 7" /></svg>
        <input aria-describedby={emailError ? "preview-email-error" : undefined} aria-invalid={emailError ? true : undefined} autoComplete="off" id="preview-email" name="email" onChange={(event) => onTextChange("email", event.target.value)} required type="email" value={values.email} placeholder="name@example.ru" />
      </div>
      {emailError ? <p className={styles.fieldError} id="preview-email-error" role="alert">{emailError}</p> : null}

      {!isReset ? (
        <>
          <span className={styles.passwordRow}>
            <label className={styles.fieldLabel} htmlFor="preview-password">Пароль</label>
            {mode === "login" ? (
              <Link
                href="/?mode=reset"
                onClick={(event) => {
                  event.preventDefault();
                  onModeChange("reset");
                }}
              >
                Забыли пароль?
              </Link>
            ) : null}
          </span>
          <div className={styles.fieldWrap}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
            <input aria-describedby={passwordError ? "preview-password-error" : undefined} aria-invalid={passwordError ? true : undefined} autoComplete="new-password" id="preview-password" name="password" onChange={(event) => onTextChange("password", event.target.value)} required type="password" value={values.password} placeholder="Введите пароль" />
          </div>
          {passwordError ? <p className={styles.fieldError} id="preview-password-error" role="alert">{passwordError}</p> : null}
          {mode === "signup" ? (
            <>
              <label className={styles.fieldLabel} htmlFor="preview-password-repeat">
                Повторите пароль
              </label>
              <div className={styles.fieldWrap}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                <input aria-describedby={passwordRepeatError ? "preview-password-repeat-error" : undefined} aria-invalid={passwordRepeatError ? true : undefined} autoComplete="new-password" id="preview-password-repeat" name="passwordRepeat" onChange={(event) => onTextChange("passwordRepeat", event.target.value)} required type="password" value={values.passwordRepeat} placeholder="Повторите пароль" />
              </div>
              {passwordRepeatError ? <p className={styles.fieldError} id="preview-password-repeat-error" role="alert">{passwordRepeatError}</p> : null}
            </>
          ) : null}
          <label className={styles.remember}>
            <input checked={values.remember} onChange={(event) => onRememberChange(event.target.checked)} type="checkbox" />
            <span aria-hidden="true"><CheckIcon /></span>
            Запомнить меня
          </label>
        </>
      ) : null}

      {authState.message && !hasFieldErrors ? (
        <p className={`${styles.description} ${styles.authError}`} role="alert">
          {authState.message}
        </p>
      ) : null}

      <button className={styles.primary} disabled={pending} type="submit">
        {pending ? "Пожалуйста, подождите…" : screen.submit}
        <ArrowIcon />
      </button>

      {mode === "reset" ? (
        <footer className={styles.footer}>
          <p>
            <Link
              href="/"
              onClick={(event) => {
                event.preventDefault();
                onModeChange("login");
              }}
            >
              Вернуться ко входу
            </Link>
          </p>
        </footer>
      ) : null}
    </form>
  );
}

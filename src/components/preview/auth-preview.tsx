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
        />
      </section>
    </main>
  );
}

type AuthPreviewFormProps = {
  action?: AuthPreviewAction;
  mode: AuthPreviewMode;
  onModeChange: (mode: AuthPreviewMode) => void;
};

function AuthPreviewForm({ action, mode, onModeChange }: AuthPreviewFormProps) {
  const [authState, formAction, pending] = useActionState(
    action ?? previewAction,
    initialAuthActionState,
  );
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const screen = copy[mode];
  const isReset = mode === "reset";

  return (
    <form
      autoComplete="off"
      action={formAction}
      aria-label={mode === "signup" ? "Регистрация" : mode === "reset" ? "Восстановление пароля" : "Авторизация"}
      className={`${styles.card} ${isReset ? styles.resetCard : ""}`}
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
        <input autoComplete="off" id="preview-email" name="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} placeholder="name@example.ru" />
      </div>

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
            <input autoComplete="new-password" id="preview-password" name="password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} placeholder="Введите пароль" />
          </div>
          {mode === "signup" ? (
            <>
              <label className={styles.fieldLabel} htmlFor="preview-password-repeat">
                Повторите пароль
              </label>
              <div className={styles.fieldWrap}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                <input autoComplete="new-password" id="preview-password-repeat" name="passwordRepeat" onChange={(event) => setPasswordRepeat(event.target.value)} type="password" value={passwordRepeat} placeholder="Повторите пароль" />
              </div>
            </>
          ) : null}
          <label className={styles.remember}>
            <input checked={remember} onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
            <span aria-hidden="true"><CheckIcon /></span>
            Запомнить меня
          </label>
        </>
      ) : null}

      {authState.message ? (
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

"use client";

import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import { useEffect, useState } from "react";
import type { AuthActionState } from "@/features/auth/state";
import styles from "./auth-preview.module.css";

type AuthPreviewMode = "login" | "signup" | "reset";

type AuthPreviewProps = {
  /** Kept temporarily for call-site compatibility; token authentication is not wired to the existing backend. */
  actions?: {
    login: (state: AuthActionState, formData: FormData) => Promise<AuthActionState>;
    signup: (state: AuthActionState, formData: FormData) => Promise<AuthActionState>;
  };
  mode: AuthPreviewMode;
};

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

function createRegistrationToken() {
  const bytes = window.crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `pfc_${token}`;
}

export function AuthPreview({ mode }: AuthPreviewProps) {
  const [activeMode, setActiveMode] = useState(mode);
  const [authToken, setAuthToken] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");
  const [secretWord, setSecretWord] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handlePopState = () => {
      const nextMode = new URLSearchParams(window.location.search).get("mode");
      setActiveMode(nextMode === "signup" ? "signup" : nextMode === "reset" ? "reset" : "login");
      setMessage("");
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateMode = (nextMode: "login" | "signup") => {
    const href = nextMode === "login" ? "/" : "/?mode=signup";
    window.history.pushState(null, "", href);
    setActiveMode(nextMode);
    setMessage("");
  };

  const isSignup = activeMode === "signup";
  const isRecovery = activeMode === "reset";

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
        <form
          aria-label={isSignup ? "Регистрация" : isRecovery ? "Восстановление доступа" : "Авторизация"}
          className={styles.card}
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(
              isSignup
                ? "Регистрация по токену пока не подключена к серверу."
                : "Вход по токену пока не подключён к серверу.",
            );
          }}
        >
          {!isRecovery ? (
            <div className={styles.tabs} role="tablist" aria-label="Режим входа">
              <Link
                aria-selected={!isSignup}
                className={!isSignup ? styles.tabActive : styles.tab}
                href="/"
                onClick={(event) => {
                  event.preventDefault();
                  navigateMode("login");
                }}
                role="tab"
              >
                Войти
              </Link>
              <Link
                aria-selected={isSignup}
                className={isSignup ? styles.tabActive : styles.tab}
                href="/?mode=signup"
                onClick={(event) => {
                  event.preventDefault();
                  navigateMode("signup");
                }}
                role="tab"
              >
                Регистрация
              </Link>
            </div>
          ) : null}

          <h1 id="auth-preview-title">
            {isRecovery ? "Восстановление доступа" : isSignup ? "Создайте аккаунт" : "Вход в аккаунт"}
          </h1>

          {isRecovery ? (
            <>
              <p className={styles.description}>
                Если вы забыли токен, восстановить доступ можно только через службу поддержки.
              </p>
              <button className={styles.primary} onClick={() => navigateMode("login")} type="button">
                Вернуться ко входу
                <ArrowIcon />
              </button>
            </>
          ) : isSignup ? (
            <>
              <p className={styles.description}>
                Добро пожаловать! Создайте токен регистрации и сохраните его. Все дальнейшие авторизации будут происходить через этот токен. Если вы его забудете, восстановить токен можно только через службу поддержки.
              </p>

              {!registrationToken ? (
                <button
                  className={styles.generateToken}
                  onClick={() => {
                    setRegistrationToken(createRegistrationToken());
                    setMessage("");
                  }}
                  type="button"
                >
                  Создать токен регистрации
                </button>
              ) : null}

              {registrationToken ? (
                <>
                  <label className={styles.fieldLabel} htmlFor="registration-token">
                    Токен регистрации
                  </label>
                  <div className={styles.fieldWrap}>
                    <input
                      className={styles.generatedToken}
                      id="registration-token"
                      onFocus={(event) => event.currentTarget.select()}
                      readOnly
                      value={registrationToken}
                    />
                  </div>
                </>
              ) : null}

              <label className={styles.fieldLabel} htmlFor="secret-word">
                Секретное слово
              </label>
              <div className={styles.fieldWrap}>
                <input
                  autoComplete="off"
                  id="secret-word"
                  onChange={(event) => setSecretWord(event.target.value)}
                  required
                  type="password"
                  value={secretWord}
                  placeholder="Придумайте секретное слово"
                />
              </div>

              {message ? <p className={styles.authError} role="status">{message}</p> : null}
              <button className={styles.primary} disabled={!registrationToken} type="submit">
                Зарегистрироваться
                <ArrowIcon />
              </button>
            </>
          ) : (
            <>
              <p className={styles.description}>
                Введите токен авторизации, сохранённый при регистрации.
              </p>
              <label className={styles.fieldLabel} htmlFor="authorization-token">
                Токен авторизации
              </label>
              <div className={styles.fieldWrap}>
                <input
                  autoComplete="off"
                  id="authorization-token"
                  onChange={(event) => setAuthToken(event.target.value)}
                  required
                  type="password"
                  value={authToken}
                  placeholder="Введите токен авторизации"
                />
              </div>
              {message ? <p className={styles.authError} role="status">{message}</p> : null}
              <button className={styles.primary} type="submit">
                Войти
                <ArrowIcon />
              </button>
            </>
          )}
        </form>
      </section>
    </main>
  );
}

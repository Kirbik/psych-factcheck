"use client";

import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import { useActionState, useEffect, useState } from "react";
import type { AuthActionState } from "@/features/auth/state";
import { initialAuthActionState } from "@/features/auth/state";
import styles from "./auth-preview.module.css";

type AuthPreviewMode = "login" | "signup" | "reset";

type AuthPreviewProps = {
  actions: {
    login: (
      state: AuthActionState,
      formData: FormData,
    ) => Promise<AuthActionState>;
    generateToken: (
      state: AuthActionState,
      formData: FormData,
    ) => Promise<AuthActionState>;
    signup: (
      state: AuthActionState,
      formData: FormData,
    ) => Promise<AuthActionState>;
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

export function AuthPreview({ actions, mode }: AuthPreviewProps) {
  const [activeMode, setActiveMode] = useState(mode);
  const [authToken, setAuthToken] = useState("");
  const [secretWord, setSecretWord] = useState("");
  const [tokenGenerationState, generateTokenAction, tokenGenerationPending] =
    useActionState(actions.generateToken, initialAuthActionState);
  const [loginState, loginAction, loginPending] = useActionState(
    actions.login,
    initialAuthActionState,
  );
  const [registrationState, registrationAction, registrationPending] =
    useActionState(actions.signup, initialAuthActionState);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handlePopState = () => {
      const nextMode = new URLSearchParams(window.location.search).get("mode");
      setActiveMode(
        nextMode === "signup"
          ? "signup"
          : nextMode === "reset"
            ? "reset"
            : "login",
      );
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
  const generatedToken = tokenGenerationState.generatedToken;
  const secretWordLength = Array.from(secretWord.replace(/\s/g, "")).length;
  const canRegister = Boolean(generatedToken) && secretWordLength >= 3 && secretWordLength <= 100;

  return (
    <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
      <header className={styles.header}>
        <Link
          className={styles.brand}
          href="/"
          aria-label="Псих Фактчек — вход"
        >
          <span className={styles.mark}>
            <CheckIcon />
          </span>
          <span>Псих Фактчек</span>
        </Link>
        <nav className={styles.nav} aria-label="Навигация макета">
          <a href="#how">Как это работает</a>
          <a href="#about">О сервисе</a>
          <a href="#sources">Источники</a>
          <Link
            className={styles.signIn}
            href="/"
            onNavigate={(event) => {
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
          aria-label={
            isSignup
              ? "Регистрация"
              : isRecovery
                ? "Восстановление доступа"
                : "Авторизация"
          }
          action={isSignup ? registrationAction : loginAction}
          className={styles.card}
        >
          {!isRecovery ? (
            <div
              className={styles.tabs}
              role="tablist"
              aria-label="Режим входа"
            >
              <button
                aria-selected={!isSignup}
                className={!isSignup ? styles.tabActive : styles.tab}
                onClick={() => navigateMode("login")}
                role="tab"
                type="button"
              >
                Войти
              </button>
              <button
                aria-selected={isSignup}
                className={isSignup ? styles.tabActive : styles.tab}
                onClick={() => navigateMode("signup")}
                role="tab"
                type="button"
              >
                Регистрация
              </button>
            </div>
          ) : null}

          <h1 id="auth-preview-title">
            {isRecovery
              ? "Восстановление доступа"
              : isSignup
                ? "Создайте аккаунт"
                : "Вход в аккаунт"}
          </h1>

          {isRecovery ? (
            <>
              <p className={styles.description}>
                Если токен утерян, создайте новый аккаунт. История прежнего
                аккаунта не переносится.
              </p>
              <button
                className={styles.primary}
                onClick={() => navigateMode("login")}
                type="button"
              >
                Вернуться ко входу
                <ArrowIcon />
              </button>
            </>
          ) : isSignup ? (
            <>
              <p className={styles.description}>
                Сначала сгенерируйте и сохраните токен, затем придумайте
                кодовое слово для следующих входов.
              </p>

              {registrationState.registrationComplete ? (
                <>
                  <label
                    className={styles.fieldLabel}
                    htmlFor="registration-token"
                  >
                    Токен регистрации
                  </label>
                  <div className={styles.fieldWrap}>
                    <input
                      className={styles.generatedToken}
                      id="registration-token"
                      onFocus={(event) => event.currentTarget.select()}
                      readOnly
                      value={generatedToken ?? ""}
                    />
                  </div>
                  <p className={styles.description} role="status">
                    {registrationState.message}
                  </p>
                  <Link className={styles.primary} href="/ui-preview/history">
                    Перейти к проверкам
                  </Link>
                </>
              ) : (
                <>
                  <label
                    className={styles.fieldLabel}
                    htmlFor="registration-token"
                  >
                    Токен регистрации
                  </label>
                  <div className={styles.tokenRow}>
                    <div className={styles.fieldWrap}>
                      <input
                        aria-describedby={
                          registrationState.fieldErrors?.token
                            ? "registration-token-error"
                            : undefined
                        }
                        aria-invalid={
                          registrationState.fieldErrors?.token ? true : undefined
                        }
                        className={styles.generatedToken}
                        id="registration-token"
                        name="token"
                        onFocus={(event) => event.currentTarget.select()}
                        placeholder="Появится после создания"
                        readOnly
                        value={generatedToken ?? ""}
                      />
                    </div>
                    {!generatedToken || registrationState.fieldErrors?.token ? (
                      <button
                        className={`${styles.primary} ${styles.tokenCreateButton}`}
                        disabled={tokenGenerationPending || registrationPending}
                        formAction={generateTokenAction}
                        type="submit"
                      >
                        {tokenGenerationPending
                          ? "Генерируем…"
                          : "Сгенерировать"}
                      </button>
                    ) : null}
                  </div>
                  {registrationState.fieldErrors?.token ? (
                    <p
                      className={styles.fieldError}
                      id="registration-token-error"
                      role="alert"
                    >
                      {registrationState.fieldErrors.token[0]}
                    </p>
                  ) : null}
                  {!generatedToken && tokenGenerationState.message ? (
                    <p className={styles.authError} role="alert">
                      {tokenGenerationState.message}
                    </p>
                  ) : null}
                  {generatedToken && tokenGenerationState.message ? (
                    <p className={styles.description} role="status">
                      {tokenGenerationState.message}
                    </p>
                  ) : null}
                  <label className={styles.fieldLabel} htmlFor="secret-word">
                    Кодовое слово
                  </label>
                  <div className={styles.fieldWrap}>
                    <input
                      autoComplete="off"
                      aria-describedby={
                        registrationState.fieldErrors?.secretWord
                          ? "secret-word-error"
                          : undefined
                      }
                      aria-invalid={
                        registrationState.fieldErrors?.secretWord
                          ? true
                          : undefined
                      }
                      disabled={!generatedToken}
                      id="secret-word"
                      name="secretWord"
                      onChange={(event) => setSecretWord(event.target.value)}
                      required
                      type="password"
                      value={secretWord}
                      placeholder="Введите кодовое слово"
                    />
                  </div>
                  {registrationState.fieldErrors?.secretWord ? (
                    <p
                      className={styles.fieldError}
                      id="secret-word-error"
                      role="alert"
                    >
                      {registrationState.fieldErrors.secretWord[0]}
                    </p>
                  ) : null}
                  {registrationState.message ? (
                    <p className={styles.authError} role="alert">
                      {registrationState.message}
                    </p>
                  ) : null}
                  <button
                    className={styles.primary}
                    disabled={!canRegister || registrationPending}
                    type="submit"
                  >
                    {registrationPending ? "Регистрируем…" : "Регистрация"}
                    <ArrowIcon />
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <p className={styles.description}>
                Введите токен авторизации, сохранённый при регистрации.
              </p>
              <label
                className={styles.fieldLabel}
                htmlFor="authorization-token"
              >
                Токен авторизации
              </label>
              <div className={styles.fieldWrap}>
                <input
                  autoComplete="off"
                  id="authorization-token"
                  name="token"
                  onChange={(event) => setAuthToken(event.target.value)}
                  required
                  type="password"
                  value={authToken}
                  placeholder="Введите токен авторизации"
                />
              </div>
              {loginState.message ? (
                <p className={styles.authError} role="alert">
                  {loginState.message}
                </p>
              ) : null}
              {message ? (
                <p className={styles.authError} role="status">
                  {message}
                </p>
              ) : null}
              <button
                className={styles.primary}
                disabled={loginPending}
                type="submit"
              >
                {loginPending ? "Входим…" : null}
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

"use client";

import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import { useActionState, useEffect, useRef, useState } from "react";
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

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="13" rx="2" width="13" x="8" y="8" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

export function AuthPreview({ actions, mode }: AuthPreviewProps) {
  const [activeMode, setActiveMode] = useState(mode);
  const [authToken, setAuthToken] = useState("");
  const [tokenGenerationState, generateTokenAction, tokenGenerationPending] =
    useActionState(actions.generateToken, initialAuthActionState);
  const [loginState, loginAction, loginPending] = useActionState(
    actions.login,
    initialAuthActionState,
  );
  const [registrationState, registrationAction, registrationPending] =
    useActionState(actions.signup, initialAuthActionState);
  const recoveryDialogRef = useRef<HTMLDialogElement>(null);
  const recoveryCodeInputRef = useRef<HTMLInputElement>(null);
  const [recoveryDialogDismissed, setRecoveryDialogDismissed] = useState(false);
  const [message, setMessage] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<{
    target: "token" | "recoveryCode";
    result: "copied" | "error";
  } | null>(null);

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

  useEffect(() => {
    if (
      !registrationState.registrationComplete ||
      !registrationState.recoveryCode ||
      recoveryDialogDismissed
    ) {
      return;
    }

    const dialog = recoveryDialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [
    recoveryDialogDismissed,
    registrationState.recoveryCode,
    registrationState.registrationComplete,
  ]);

  useEffect(() => {
    if (recoveryDialogDismissed) {
      recoveryCodeInputRef.current?.focus();
    }
  }, [recoveryDialogDismissed]);

  const navigateMode = (nextMode: "login" | "signup") => {
    const href = nextMode === "login" ? "/" : "/?mode=signup";
    window.history.pushState(null, "", href);
    setActiveMode(nextMode);
    setMessage("");
  };

  const isSignup = activeMode === "signup";
  const isRecovery = activeMode === "reset";
  const generatedToken = tokenGenerationState.generatedToken;
  const canRegister = Boolean(generatedToken);

  const copySecret = async (
    value: string | undefined,
    target: "token" | "recoveryCode",
  ) => {
    if (!value) return;

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is unavailable");
      }
      await navigator.clipboard.writeText(value);
      setCopyFeedback({ target, result: "copied" });
    } catch {
      setCopyFeedback({ target, result: "error" });
    }
  };

  const renderCopyFeedback = (target: "token" | "recoveryCode") =>
    copyFeedback?.target === target ? (
      <p
        className={
          copyFeedback.result === "copied"
            ? styles.tokenCopyStatus
            : styles.fieldError
        }
        role={copyFeedback.result === "copied" ? "status" : "alert"}
      >
        {copyFeedback.result === "copied"
          ? target === "token"
            ? "Токен скопирован"
            : "Код восстановления скопирован"
          : "Не удалось скопировать. Выделите значение и скопируйте вручную"}
      </p>
    ) : null;

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
              </button>
            </>
          ) : isSignup ? (
            <>
              <p className={styles.description}>
                Сначала сгенерируйте и сохраните токен. После регистрации
                появится код восстановления.
              </p>

              {registrationState.registrationComplete ? (
                <>
                  {!recoveryDialogDismissed ? (
                    <dialog
                      aria-describedby="recovery-dialog-description"
                      aria-labelledby="recovery-dialog-title"
                      className={`${styles.card} ${styles.recoveryDialog}`}
                      onClose={() => setRecoveryDialogDismissed(true)}
                      ref={recoveryDialogRef}
                    >
                      <h2 id="recovery-dialog-title">
                        Сохраните код восстановления
                      </h2>
                      <p
                        className={`${styles.description} ${styles.tokenNotice}`}
                        id="recovery-dialog-description"
                      >
                        Сохраните этот код: без него восстановить утерянный
                        токен не получится.
                      </p>
                      <label
                        className={styles.fieldLabel}
                        htmlFor="recovery-code-dialog"
                      >
                        Код восстановления
                      </label>
                      <div className={styles.fieldWrap}>
                        <input
                          className={styles.generatedToken}
                          id="recovery-code-dialog"
                          onFocus={(event) => event.currentTarget.select()}
                          readOnly
                          value={registrationState.recoveryCode}
                        />
                        <button
                          aria-label="Скопировать код восстановления"
                          className={styles.tokenCopyButton}
                          onClick={() =>
                            copySecret(
                              registrationState.recoveryCode,
                              "recoveryCode",
                            )
                          }
                          type="button"
                        >
                          <CopyIcon />
                        </button>
                      </div>
                      {renderCopyFeedback("recoveryCode")}
                      <button
                        className={styles.primary}
                        onClick={() => recoveryDialogRef.current?.close()}
                        type="button"
                      >
                        Понятно
                      </button>
                    </dialog>
                  ) : null}
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
                    <button
                      aria-label="Скопировать токен"
                      className={styles.tokenCopyButton}
                      onClick={() => copySecret(generatedToken, "token")}
                      type="button"
                    >
                      <CopyIcon />
                    </button>
                  </div>
                  {renderCopyFeedback("token")}
                  {loginState.message ? (
                    <p className={styles.authError} role="alert">
                      {loginState.message}
                    </p>
                  ) : null}
                  {recoveryDialogDismissed ? (
                    <>
                      <label
                        className={styles.fieldLabel}
                        htmlFor="recovery-code"
                      >
                        Код восстановления
                      </label>
                      <div className={styles.fieldWrap}>
                        <input
                          className={styles.generatedToken}
                          id="recovery-code"
                          onFocus={(event) => event.currentTarget.select()}
                          ref={recoveryCodeInputRef}
                          readOnly
                          value={registrationState.recoveryCode ?? ""}
                        />
                        <button
                          aria-label="Скопировать код восстановления"
                          className={styles.tokenCopyButton}
                          onClick={() =>
                            copySecret(
                              registrationState.recoveryCode,
                              "recoveryCode",
                            )
                          }
                          type="button"
                        >
                          <CopyIcon />
                        </button>
                      </div>
                      {renderCopyFeedback("recoveryCode")}
                    </>
                  ) : null}
                  <p
                    className={`${styles.description} ${styles.tokenNotice}`}
                    role="status"
                  >
                    {registrationState.message}
                  </p>
                  <input
                    name="token"
                    type="hidden"
                    value={generatedToken ?? ""}
                  />
                  <button
                    className={styles.primary}
                    disabled={loginPending}
                    formAction={loginAction}
                    type="submit"
                  >
                    {loginPending ? "Переходим…" : "Перейти к проверкам"}
                  </button>
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
                          registrationState.fieldErrors?.token
                            ? true
                            : undefined
                        }
                        className={styles.generatedToken}
                        id="registration-token"
                        name="token"
                        onFocus={(event) => event.currentTarget.select()}
                        placeholder="Появится после создания"
                        readOnly
                        value={generatedToken ?? ""}
                      />
                      {generatedToken ? (
                        <button
                          aria-label="Скопировать токен"
                          className={styles.tokenCopyButton}
                          onClick={() => copySecret(generatedToken, "token")}
                          type="button"
                        >
                          <CopyIcon />
                        </button>
                      ) : null}
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
                  {renderCopyFeedback("token")}
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
                    <p
                      className={`${styles.description} ${styles.tokenNotice}`}
                      role="status"
                    >
                      {tokenGenerationState.message}
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
                    onClick={() => setCopyFeedback(null)}
                    type="submit"
                  >
                    {registrationPending ? "Регистрируем…" : "Регистрация"}
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
              </button>
            </>
          )}
        </form>
      </section>
    </main>
  );
}

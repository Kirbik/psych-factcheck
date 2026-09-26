"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  clearFirstLoginSecrets,
  getFirstLoginSecretsSnapshot,
  parseFirstLoginSecrets,
  subscribeToFirstLoginSecrets,
} from "@/features/auth/first-login-secrets";
import styles from "./auth-preview.module.css";

type CopyTarget = "token" | "recoveryCode";

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="13" rx="2" width="13" x="8" y="8" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

export function FirstLoginSecretsModal() {
  const snapshot = useSyncExternalStore(
    subscribeToFirstLoginSecrets,
    getFirstLoginSecretsSnapshot,
    () => null,
  );
  const [dismissed, setDismissed] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyTarget | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const secrets = parseFirstLoginSecrets(snapshot);
  const visibleSecrets = dismissed ? null : secrets;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (visibleSecrets && dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [visibleSecrets]);

  const copySecret = async (value: string, target: CopyTarget) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is unavailable");
      }
      await navigator.clipboard.writeText(value);
      setCopyFeedback(target);
    } catch {
      setCopyFeedback(null);
    }
  };

  const dismiss = () => {
    clearFirstLoginSecrets();
    dialogRef.current?.close();
  };

  if (!visibleSecrets) {
    return null;
  }

  return (
    <dialog
      aria-describedby="first-login-secrets-description"
      aria-labelledby="first-login-secrets-title"
      className={`${styles.card} ${styles.recoveryDialog} ${styles.recoveryDialogScope}`}
      onCancel={(event) => event.preventDefault()}
      onClose={() => setDismissed(true)}
      ref={dialogRef}
    >
      <h2 id="first-login-secrets-title">Сохраните данные для доступа</h2>
      <p
        className={`${styles.description} ${styles.tokenNotice}`}
        id="first-login-secrets-description"
      >
        Сохраните токен и код восстановления. После закрытия окна повторно
        показать их не получится.
      </p>
      <label className={styles.fieldLabel} htmlFor="first-login-token">
        Токен авторизации
      </label>
      <div className={styles.fieldWrap}>
        <input
          className={styles.generatedToken}
          id="first-login-token"
          readOnly
          value={visibleSecrets.token}
        />
        <button
          aria-label="Скопировать токен авторизации"
          className={styles.tokenCopyButton}
          onClick={() => copySecret(visibleSecrets.token, "token")}
          type="button"
        >
          <CopyIcon />
        </button>
      </div>
      {copyFeedback === "token" ? (
        <p className={styles.tokenCopyStatus} role="status">
          Токен скопирован
        </p>
      ) : null}
      <label
        className={styles.fieldLabel}
        htmlFor="first-login-recovery-code"
      >
        Код восстановления
      </label>
      <div className={styles.fieldWrap}>
        <input
          className={styles.generatedToken}
          id="first-login-recovery-code"
          readOnly
          value={visibleSecrets.recoveryCode}
        />
        <button
          aria-label="Скопировать код восстановления"
          className={styles.tokenCopyButton}
          onClick={() => copySecret(visibleSecrets.recoveryCode, "recoveryCode")}
          type="button"
        >
          <CopyIcon />
        </button>
      </div>
      {copyFeedback === "recoveryCode" ? (
        <p className={styles.tokenCopyStatus} role="status">
          Код восстановления скопирован
        </p>
      ) : null}
      <button className={styles.primary} onClick={dismiss} type="button">
        Понятно
      </button>
    </dialog>
  );
}

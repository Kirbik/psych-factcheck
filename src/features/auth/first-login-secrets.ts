export const firstLoginSecretsStorageKey =
  "psych-factcheck:first-login-secrets:v1";
const firstLoginSecretsChangeEvent = "psych-factcheck:first-login-secrets-change";

export type FirstLoginSecrets = {
  token: string;
  recoveryCode: string;
};

const tokenPattern = /^pfc_[a-f0-9]{64}$/;
const recoveryCodePattern = /^pfr_[a-f0-9]{64}$/;

function isFirstLoginSecrets(value: unknown): value is FirstLoginSecrets {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const secrets = value as Record<string, unknown>;
  return (
    typeof secrets.token === "string" &&
    tokenPattern.test(secrets.token) &&
    typeof secrets.recoveryCode === "string" &&
    recoveryCodePattern.test(secrets.recoveryCode)
  );
}

export function parseFirstLoginSecrets(serialized: string | null) {
  if (!serialized) {
    return null;
  }

  try {
    const secrets: unknown = JSON.parse(serialized);
    return isFirstLoginSecrets(secrets) ? secrets : null;
  } catch {
    return null;
  }
}

export function storeFirstLoginSecrets(secrets: FirstLoginSecrets) {
  if (!isFirstLoginSecrets(secrets) || typeof window === "undefined") {
    return false;
  }

  try {
    window.sessionStorage.setItem(
      firstLoginSecretsStorageKey,
      JSON.stringify(secrets),
    );
    window.dispatchEvent(new Event(firstLoginSecretsChangeEvent));
    return true;
  } catch {
    return false;
  }
}

export function readFirstLoginSecrets(): FirstLoginSecrets | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const serialized = window.sessionStorage.getItem(firstLoginSecretsStorageKey);
    const secrets = parseFirstLoginSecrets(serialized);
    if (secrets) {
      return secrets;
    }

    if (serialized) {
      window.sessionStorage.removeItem(firstLoginSecretsStorageKey);
    }
  } catch {
    return null;
  }

  return null;
}

export function getFirstLoginSecretsSnapshot() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage.getItem(firstLoginSecretsStorageKey);
  } catch {
    return null;
  }
}

export function subscribeToFirstLoginSecrets(onChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(firstLoginSecretsChangeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(firstLoginSecretsChangeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function clearFirstLoginSecrets() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(firstLoginSecretsStorageKey);
    window.dispatchEvent(new Event(firstLoginSecretsChangeEvent));
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

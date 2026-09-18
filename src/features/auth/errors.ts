export const genericAuthError =
  "Не удалось выполнить действие. Попробуйте ещё раз.";

export function toSafeAuthError(message: string | undefined) {
  const normalized = message?.toLowerCase() ?? "";

  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid credentials")
  ) {
    return "Неверный email или пароль.";
  }

  if (
    normalized.includes("user already registered") ||
    normalized.includes("already been registered")
  ) {
    return "Проверьте почту, чтобы продолжить регистрацию или войти.";
  }

  return genericAuthError;
}

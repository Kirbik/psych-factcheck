export const genericAuthError =
  "Не удалось выполнить действие. Попробуйте ещё раз";

export const authServiceError =
  "Сервис авторизации временно недоступен";

export function toSafeAuthError(
  message: string | undefined,
  code?: string,
  status?: number,
) {
  const normalized = message?.toLowerCase() ?? "";
  const normalizedCode = code?.toLowerCase() ?? "";

  if (
    normalizedCode === "invalid_credentials" ||
    normalizedCode === "user_not_found" ||
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid credentials") ||
    normalized.includes("invalid_credentials")
  ) {
    return "Почта или пароль введены некорректно";
  }

  if (normalizedCode === "email_not_confirmed") {
    return "Подтвердите почту перед входом";
  }

  if (
    normalizedCode === "email_exists" ||
    normalizedCode === "user_already_exists" ||
    normalized.includes("user already registered") ||
    normalized.includes("already been registered")
  ) {
    return "Проверьте почту, чтобы продолжить регистрацию или войти";
  }

  if (status === 400) {
    return "Почта или пароль введены некорректно";
  }

  return genericAuthError;
}

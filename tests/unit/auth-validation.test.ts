import { describe, expect, it } from "vitest";
import { toSafeAuthError } from "@/features/auth/errors";
import { parseAuthCredentials } from "@/features/auth/validation";

function credentials(values: Record<string, string>) {
  const formData = new FormData();
  Object.entries(values).forEach(([name, value]) => formData.set(name, value));
  return formData;
}

describe("auth credential validation", () => {
  it("accepts an email and a sufficiently long password", () => {
    expect(
      parseAuthCredentials(
        credentials({ email: "person@example.com", password: "safe-password-123" }),
      ).success,
    ).toBe(true);
  });

  it("rejects empty, malformed, and short values", () => {
    const result = parseAuthCredentials(
      credentials({ email: "not-an-email", password: "short" }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toMatchObject({
        email: [expect.any(String)],
        password: [expect.any(String)],
      });
    }
  });
});

describe("provider auth errors", () => {
  it("maps invalid credentials without exposing provider details", () => {
    expect(toSafeAuthError("Invalid login credentials")).toBe(
      "Неверный email или пароль.",
    );
  });

  it("maps unknown provider failures to a generic message", () => {
    expect(toSafeAuthError("unexpected internal diagnostic")).toBe(
      "Не удалось выполнить действие. Попробуйте ещё раз.",
    );
  });
});

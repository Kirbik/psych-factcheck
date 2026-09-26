import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authConfigurationError,
  authServiceError,
} from "@/features/auth/errors";
import { initialAuthActionState } from "@/features/auth/state";

const { authenticateWithAccessToken, registerAccessTokenAccount, redirect } =
  vi.hoisted(() => ({
    authenticateWithAccessToken: vi.fn(),
    registerAccessTokenAccount: vi.fn(),
    redirect: vi.fn(),
  }));

vi.mock("@/server/supabase/access-token-auth", () => ({
  authenticateWithAccessToken,
  registerAccessTokenAccount,
  InvalidAccessTokenError: class InvalidAccessTokenError extends Error {},
}));
vi.mock("@/server/supabase/auth", () => ({ createServerAuthClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

import { registerWithToken, signInWithToken } from "@/features/auth/actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([name, value]) => data.set(name, value));
  return data;
}

describe("token auth actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns a generated token only after server-side registration completes", async () => {
    registerAccessTokenAccount.mockResolvedValue(`pfc_${"a".repeat(64)}`);

    await expect(
      registerWithToken(
        initialAuthActionState,
        formData({ secretWord: "one two three" }),
      ),
    ).resolves.toEqual({
      generatedToken: `pfc_${"a".repeat(64)}`,
      message: "Сохраните токен. Повторно показать его будет невозможно.",
    });
    expect(registerAccessTokenAccount).toHaveBeenCalledOnce();
  });

  it("does not create an account when the registration codeword is invalid", async () => {
    await expect(
      registerWithToken(
        initialAuthActionState,
        formData({ secretWord: "a b" }),
      ),
    ).resolves.toMatchObject({
      message: "Проверьте введённые данные",
      fieldErrors: { secretWord: [expect.any(String)] },
    });
    expect(registerAccessTokenAccount).not.toHaveBeenCalled();
  });

  it("maps missing server configuration to a safe message", async () => {
    const configurationError = new Error("secret config is missing");
    configurationError.name = "ZodError";
    registerAccessTokenAccount.mockRejectedValue(configurationError);

    await expect(
      registerWithToken(
        initialAuthActionState,
        formData({ secretWord: "one two three" }),
      ),
    ).resolves.toEqual({ message: authConfigurationError });
  });

  it("requires a valid token format before looking up an account", async () => {
    await expect(
      signInWithToken(initialAuthActionState, formData({ token: "invalid" })),
    ).resolves.toMatchObject({ message: "Проверьте введённый токен" });
    expect(authenticateWithAccessToken).not.toHaveBeenCalled();
  });

  it("maps unexpected auth failures without exposing provider details", async () => {
    authenticateWithAccessToken.mockRejectedValue(
      new Error("raw internal failure"),
    );

    await expect(
      signInWithToken(
        initialAuthActionState,
        formData({ token: `pfc_${"a".repeat(64)}` }),
      ),
    ).resolves.toEqual({ message: authServiceError });
  });
});

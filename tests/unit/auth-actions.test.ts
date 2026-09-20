import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authConfigurationError,
  authServiceError,
} from "@/features/auth/errors";
import { initialAuthActionState } from "@/features/auth/state";

const { createServerAuthClient, redirect } = vi.hoisted(() => ({
  createServerAuthClient: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/server/supabase/auth", () => ({ createServerAuthClient }));
vi.mock("next/navigation", () => ({ redirect }));

import { signIn } from "@/features/auth/actions";

function credentials(values: Record<string, string>) {
  const formData = new FormData();
  Object.entries(values).forEach(([name, value]) => formData.set(name, value));
  return formData;
}

describe("auth actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns a safe error when the server auth request cannot be created", async () => {
    createServerAuthClient.mockRejectedValue(new Error("missing runtime config"));

    await expect(
      signIn(
        initialAuthActionState,
        credentials({
          email: "person@example.com",
          password: "safe-password-123",
        }),
      ),
    ).resolves.toEqual({ message: authServiceError });
  });

  it("identifies invalid Supabase configuration without exposing details", async () => {
    const configurationError = new Error("invalid configuration");
    configurationError.name = "ZodError";
    createServerAuthClient.mockRejectedValue(configurationError);

    await expect(
      signIn(
        initialAuthActionState,
        credentials({
          email: "person@example.com",
          password: "safe-password-123",
        }),
      ),
    ).resolves.toEqual({ message: authConfigurationError });
  });
});

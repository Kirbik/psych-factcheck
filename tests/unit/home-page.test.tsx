import { describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { AuthPreview } from "@/components/preview/auth-preview";

const { generateRegistrationToken, signInWithToken, registerWithToken } = vi.hoisted(() => ({
  generateRegistrationToken: vi.fn(),
  signInWithToken: vi.fn(),
  registerWithToken: vi.fn(),
}));

vi.mock("@/features/auth/actions", () => ({
  generateRegistrationToken,
  signInWithToken,
  registerWithToken,
}));

describe("HomePage", () => {
  it("renders the login preview at the root route", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });

    expect(page).toEqual(
      expect.objectContaining({
        type: AuthPreview,
        props: expect.objectContaining({
          actions: expect.objectContaining({
            generateToken: generateRegistrationToken,
            login: signInWithToken,
            signup: registerWithToken,
          }),
          mode: "login",
        }),
      }),
    );
  });
});

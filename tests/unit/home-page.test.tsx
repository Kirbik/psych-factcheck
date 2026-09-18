import { describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { AuthPreview } from "@/components/preview/auth-preview";

const { signIn, signUp } = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/features/auth/actions", () => ({ signIn, signUp }));

describe("HomePage", () => {
  it("renders the login preview at the root route", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });

    expect(page).toEqual(
      expect.objectContaining({
        type: AuthPreview,
        props: expect.objectContaining({
          action: expect.any(Function),
          mode: "login",
        }),
      }),
    );
  });
});

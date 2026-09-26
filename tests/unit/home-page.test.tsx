import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import AuthPreviewPage from "@/app/ui-preview/auth/page";
import { AuthPreview } from "@/components/preview/auth-preview";

const {
  generateRegistrationToken,
  getClaims,
  redirect,
  signInWithToken,
  registerWithToken,
} = vi.hoisted(() => ({
  generateRegistrationToken: vi.fn(),
  getClaims: vi.fn(async (): Promise<{
    data: { claims: Record<string, unknown> };
    error: null;
  }> => ({ data: { claims: {} }, error: null })),
  redirect: vi.fn(() => undefined),
  signInWithToken: vi.fn(),
  registerWithToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("server-only", () => ({}));

vi.mock("@/features/auth/actions", () => ({
  generateRegistrationToken,
  signInWithToken,
  registerWithToken,
}));

vi.mock("@/server/supabase/auth", () => ({
  createServerAuthClient: vi.fn(async () => ({ auth: { getClaims } })),
}));

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
  });

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
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects authenticated visitors from the root to check history", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "user-123" } },
      error: null,
    });

    await HomePage({ searchParams: Promise.resolve({ mode: "signup" }) });

    expect(redirect).toHaveBeenCalledWith("/ui-preview/history");
  });

  it("redirects authenticated visitors from the auth preview to check history", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "user-123" } },
      error: null,
    });

    await AuthPreviewPage({
      searchParams: Promise.resolve({ mode: "signup" }),
    });

    expect(redirect).toHaveBeenCalledWith("/ui-preview/history");
  });

  it("keeps auth available when the session cannot be verified", async () => {
    getClaims.mockRejectedValueOnce(new Error("Supabase unavailable"));

    const page = await HomePage({ searchParams: Promise.resolve({}) });

    expect(page).toEqual(expect.objectContaining({ type: AuthPreview }));
    expect(redirect).not.toHaveBeenCalled();
  });
});

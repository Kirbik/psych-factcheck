import { describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect }));

describe("HomePage", () => {
  it("redirects to the signup preview route", () => {
    const redirectSignal = new Error("redirect");
    redirect.mockImplementation(() => {
      throw redirectSignal;
    });

    expect(() => HomePage()).toThrow(redirectSignal);
    expect(redirect).toHaveBeenCalledWith("/ui-preview/auth?mode=signup");
  });
});

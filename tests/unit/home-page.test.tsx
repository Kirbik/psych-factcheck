import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import { AuthPreview } from "@/components/preview/auth-preview";

describe("HomePage", () => {
  it("renders the signup preview at the root route", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });

    expect(page).toEqual(
      expect.objectContaining({
        type: AuthPreview,
        props: { mode: "signup" },
      }),
    );
  });
});

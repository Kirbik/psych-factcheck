import { describe, expect, it } from "vitest";
import { parseSignIn, parseSignUp } from "@/features/auth/validation";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([name, value]) => data.set(name, value));
  return data;
}

describe("token authentication validation", () => {
  it("accepts a registration codeword with 3 to 100 non-whitespace characters", () => {
    expect(parseSignUp(formData({ secretWord: "one two three" })).success).toBe(
      true,
    );
  });

  it("rejects a codeword that is too short or too long", () => {
    expect(parseSignUp(formData({ secretWord: "a b" })).success).toBe(false);
    expect(parseSignUp(formData({ secretWord: "x".repeat(101) })).success).toBe(
      false,
    );
  });

  it("accepts only a server-generated token format on login", () => {
    expect(
      parseSignIn(formData({ token: `pfc_${"a".repeat(64)}` })).success,
    ).toBe(true);
    expect(parseSignIn(formData({ token: "pfc_short" })).success).toBe(false);
    expect(parseSignIn(formData({ token: "" })).success).toBe(false);
  });
});

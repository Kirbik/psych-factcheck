import { describe, expect, it } from "vitest";
import { parseSignIn, parseSignUp } from "@/features/auth/validation";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([name, value]) => data.set(name, value));
  return data;
}

describe("token authentication validation", () => {
  const validToken = `pfc_${"a".repeat(64)}`;

  it("accepts registration with only the generated token", () => {
    expect(parseSignUp(formData({ token: validToken })).success).toBe(true);
  });

  it("requires a token in the server-generated format before registration", () => {
    expect(parseSignUp(formData({ token: "pfc_invalid" })).success).toBe(false);
  });

  it("accepts only a server-generated token format on login", () => {
    expect(
      parseSignIn(formData({ token: `pfc_${"a".repeat(64)}` })).success,
    ).toBe(true);
    expect(parseSignIn(formData({ token: "pfc_short" })).success).toBe(false);
    expect(parseSignIn(formData({ token: "" })).success).toBe(false);
  });
});

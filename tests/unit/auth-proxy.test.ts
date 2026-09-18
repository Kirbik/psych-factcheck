import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

describe("auth proxy matcher", () => {
  it("only runs before dashboard routes", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/dashboard",
      }),
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/login" }),
    ).toBe(false);
  });
});

import type { NextConfig } from "next";

const isVinext = process.argv[1]?.toLowerCase().includes("vinext") ?? false;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  ...(!isVinext
    ? {
        turbopack: {
          resolveAlias: {
            "cloudflare:workers": "./src/server/workflows/cloudflare-env-node.ts",
          },
        },
      }
    : {}),
};

export default nextConfig;

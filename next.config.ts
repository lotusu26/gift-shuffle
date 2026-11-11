import type { NextConfig } from "next";

const basePath = process.env.PAGES_BASE_PATH;

const nextConfig: NextConfig = {
  output: "export",
  ...(basePath ? { basePath } : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath ?? "",
  },
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

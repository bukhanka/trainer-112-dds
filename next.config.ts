import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image and the offline package.
  output: "standalone",
  poweredByHeader: false,
  // Clean screenshots from the dev server: no floating Next.js badge.
  devIndicators: false,
};

export default nextConfig;

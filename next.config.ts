import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image and the offline package.
  output: "standalone",
  poweredByHeader: false,
  // Clean screenshots from the dev server: no floating Next.js badge.
  devIndicators: false,
  experimental: {
    // The proxy (src/proxy.ts) buffers request bodies up to this size and silently cuts the rest. Uploads of the
    // library and ticket files are up to 20 MB (src/lib/materials/service.ts) plus the multipart wrapping.
    proxyClientMaxBodySize: "21mb",
  },
};

export default nextConfig;

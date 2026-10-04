import type { NextConfig } from "next";

/** Batch uploads: up to 25MB payload + multipart overhead; per-file cap remains 10MB in app code. */
const KNOWLEDGE_UPLOAD_BODY_LIMIT = "28mb";

const LONG_CACHE = "public, max-age=31536000, immutable";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["unpdf", "mammoth"],
  experimental: {
    serverActions: {
      bodySizeLimit: KNOWLEDGE_UPLOAD_BODY_LIMIT,
    },
    proxyClientMaxBodySize: KNOWLEDGE_UPLOAD_BODY_LIMIT,
  },
  async headers() {
    return [
      {
        source: "/assets/:path*",
        headers: [{ key: "Cache-Control", value: LONG_CACHE }],
      },
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: LONG_CACHE }],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;

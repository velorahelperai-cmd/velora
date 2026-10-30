import type { NextConfig } from "next";

/** Batch uploads: up to 25MB payload + multipart overhead; per-file cap remains 10MB in app code. */
const KNOWLEDGE_UPLOAD_BODY_LIMIT = "28mb";

// Unhashed public URLs may change in place. Next content-hashed assets retain
// their one-year immutable policy; HTTP owns caching instead of a second SW cache.
const PUBLIC_CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

const nextConfig: NextConfig = {
  ...(process.env.NODE_ENV === "development" && process.env.VELORA_LOCAL_CUSTOMER_MODE === "live"
    ? {distDir:"artifacts/local-live-customer/next"} : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERSION ?? "development",
    NEXT_PUBLIC_LOG_LEVEL: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  },
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
        headers: [{ key: "Cache-Control", value: PUBLIC_CACHE }],
      },
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: PUBLIC_CACHE }],
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

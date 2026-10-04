import type { NextConfig } from "next";

/** Batch uploads: up to 25MB payload + multipart overhead; per-file cap remains 10MB in app code. */
const KNOWLEDGE_UPLOAD_BODY_LIMIT = "28mb";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: KNOWLEDGE_UPLOAD_BODY_LIMIT,
    },
    proxyClientMaxBodySize: KNOWLEDGE_UPLOAD_BODY_LIMIT,
  },
};

export default nextConfig;

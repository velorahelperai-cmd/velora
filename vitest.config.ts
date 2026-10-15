import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Numeric loopback avoids Vite's startup DNS lookup under offline CI.
  server: { host: "127.0.0.1" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./scripts/test/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    // Source tests only: archived artifacts and opt-in native runners are not
    // offline acceptance. Explicit integration configs retain their own scope.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

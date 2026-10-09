import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
export default defineConfig({
  root, envDir: false,
  resolve: { alias: { "@": resolve(root, "src") } },
  test: { environment: "node", envFile: false, include: ["src/lib/whatsapp/local-http-runtime-e2e.optin.ts"], fileParallelism: false },
});

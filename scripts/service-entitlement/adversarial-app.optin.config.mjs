import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
export default defineConfig({
 cacheDir: resolve(tmpdir(), "velora-service-enforcement-vite", String(process.pid)),
 resolve: { alias: { "@": resolve("src"), "server-only": resolve("scripts/service-entitlement/adversarial-offline-guard.ts") } },
 test: { environment: "node", fileParallelism: false, maxWorkers: 1,
  setupFiles: ["scripts/service-entitlement/adversarial-offline-guard.ts"],
  include: ["src/lib/services/access.test.ts","src/lib/services/decision.test.ts",
   "src/lib/whatsapp/p4-send-action-readiness.test.ts","src/lib/whatsapp/integration-store.test.ts",
   "src/lib/whatsapp/integration-worker.test.ts","src/lib/whatsapp/send-settlement.test.ts",
   "src/app/api/internal/whatsapp/worker/route.test.ts"] }
});

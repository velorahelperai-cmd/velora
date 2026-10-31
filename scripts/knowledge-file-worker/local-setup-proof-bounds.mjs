/**
 * Records bounds for local /setup + real worker proof without mutating TAG CITY
 * or enabling paid provider extract.
 *
 * Does NOT flip production gates. Prefer disposable native + Vitest for fence proof.
 * Optional live tick against local Next (auth/observation only when gate off).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const url =
  process.env.VELORA_KNOWLEDGE_FILE_WORKER_URL?.trim()
  || "http://127.0.0.1:3330/api/internal/knowledge/file-worker";
const secret =
  process.env.VELORA_KNOWLEDGE_FILE_WORKER_SECRET?.trim()
  || process.env.CRON_SECRET?.trim()
  || "";

const evidence = {
  at: new Date().toISOString(),
  production: false,
  tagCityMutated: false,
  providerExtractEnabled: process.env.VELORA_KNOWLEDGE_FILE_WORKER_PROVIDER_EXTRACT === "true",
  workerGateEnabled: process.env.VELORA_KNOWLEDGE_FILE_WORKER_ENABLED === "true",
  bounds: [
    "External provider extract stays off for this proof",
    "TAG CITY knowledge rows / holds not mutated by this script",
    "Live /setup upload→enqueue against hosted SQL requires installed attempt package + explicit gate enable (NOT_RUN here)",
    "Disposable native PASS_ISOLATED + Vitest cover claim/replay/recovery/review/UI/runner observation",
  ],
  liveTick: null,
};

if (secret.length >= 16) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 400) };
    }
    evidence.liveTick = {
      url,
      httpStatus: res.status,
      code: body?.code ?? null,
      observationKeys: body && typeof body === "object" ? Object.keys(body) : [],
      note:
        body?.code === "WORKER_DISABLED" || body?.code === "WORKER_NOT_CONFIGURED"
          ? "Auth/route reachable; gate/schema still off — expected for TAG CITY safety"
          : "Inspect observation; do not treat as full /setup journey proof",
    };
  } catch (error) {
    evidence.liveTick = { error: String(error.message ?? error).slice(0, 400) };
  }
} else {
  evidence.liveTick = {
    skipped: true,
    reason: "No local worker/cron secret in env — route not invoked against live customer DB",
  };
}

const out = join(
  "supabase",
  "upgrade-packages",
  "knowledge-file-worker",
  "local-setup-proof-bounds.json",
);
writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(`PROOF_BOUNDS|${out}|providerExtract=${evidence.providerExtractEnabled}|gate=${evidence.workerGateEnabled}`);

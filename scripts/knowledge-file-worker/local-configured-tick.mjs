/**
 * Local-only: prove the worker route is configured (not WORKER_NOT_CONFIGURED).
 * Uses a disposable secret in-process; does not write production secrets.
 * Does not enable provider extract. Does not mutate TAG CITY when pointing at live URL
 * unless the owner explicitly sets the URL + enables the gate against a DB that has 10/11.
 *
 * Default: hits local Next; expects WORKER_DISABLED (gate off) or IDLE/COMPLETE when gate on
 * against an isolated stack — never treats 503 WORKER_NOT_CONFIGURED as success.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const url =
  process.env.VELORA_KNOWLEDGE_FILE_WORKER_URL?.trim()
  || "http://127.0.0.1:3330/api/internal/knowledge/file-worker";

const secret =
  process.env.VELORA_KNOWLEDGE_FILE_WORKER_SECRET?.trim()
  || process.env.CRON_SECRET?.trim()
  || randomBytes(24).toString("hex"); // 48 hex chars ≥ 32

if (secret.length < 32) {
  console.error("TICK|SECRET_TOO_SHORT");
  process.exit(1);
}

const res = await fetch(url, {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    accept: "application/json",
  },
});
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text.slice(0, 400) };
}

const configured = body?.code !== "WORKER_NOT_CONFIGURED";
const evidence = {
  at: new Date().toISOString(),
  url,
  httpStatus: res.status,
  code: body?.code ?? null,
  configured,
  gateEnabledEnv: process.env.VELORA_KNOWLEDGE_FILE_WORKER_ENABLED === "true",
  providerExtractEnv: process.env.VELORA_KNOWLEDGE_FILE_WORKER_PROVIDER_EXTRACT === "true",
  note:
    body?.code === "WORKER_NOT_CONFIGURED"
      ? "FAIL: local Next still lacks matching worker/cron secret"
      : body?.code === "UNAUTHORIZED"
        ? "FAIL: secret sent but Next process does not share it — restart Next with the same secret"
        : body?.code === "WORKER_DISABLED"
          ? "PASS_CONFIGURED_GATE_OFF: auth ok; enable gate only on isolated DB with 10/11"
          : "Inspect observation; TAG CITY must not receive gate-on without installed package",
  observation: body,
};
const out = join(
  "supabase",
  "upgrade-packages",
  "knowledge-file-worker",
  "local-configured-tick.observation.json",
);
writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(
  `TICK|${res.status}|${body?.code ?? "NO_CODE"}|configured=${configured}|${out}`,
);
if (!configured || body?.code === "UNAUTHORIZED") process.exitCode = 1;

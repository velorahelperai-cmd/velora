#!/usr/bin/env node
/**
 * Local / host-agnostic knowledge-file worker tick.
 * Calls the same authenticated route Vercel Cron would hit.
 *
 * Usage:
 *   node scripts/knowledge-file-worker/run-tick.mjs
 * Env:
 *   VELORA_KNOWLEDGE_FILE_WORKER_URL  (default http://127.0.0.1:3330/api/internal/knowledge/file-worker)
 *   VELORA_KNOWLEDGE_FILE_WORKER_SECRET or CRON_SECRET
 *
 * Observation: JSON body includes lastTickAt, backlog, stalledDueWork, reviewRequired.
 * Missed successful ticks (>15m) ⇒ treat worker as stopped (see observation.ts).
 *
 * Periodic host (no purchase / no new service):
 * - Primary on current Hobby project (velora-9513): Windows Task Scheduler / OS cron
 *   invoking this script. Frequent Vercel Cron is invalid on Hobby (min once/day).
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

if (secret.length < 16) {
  console.error("TICK|UNCONFIGURED|set VELORA_KNOWLEDGE_FILE_WORKER_SECRET or CRON_SECRET");
  process.exitCode = 1;
  process.exit();
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

const evidence = {
  at: new Date().toISOString(),
  url,
  httpStatus: res.status,
  observation: body,
  appearsStoppedHint:
    body?.ok !== true
    || body?.stalledDueWork === true
    || body?.code === "WORKER_DISABLED"
    || body?.code === "LIST_UNAVAILABLE",
};
const out = join(
  "supabase",
  "upgrade-packages",
  "knowledge-file-worker",
  "last-tick.observation.json",
);
writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(`TICK|${res.status}|${body?.code ?? "NO_CODE"}|backlog=${body?.backlog ?? "?"}|${out}`);
if (res.status >= 500) process.exitCode = 1;

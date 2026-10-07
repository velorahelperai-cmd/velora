#!/usr/bin/env node
/**
 * VEL-PAYMENT-CONCURRENCY-CAPACITY-01 — safe local load harness.
 * Refuses cloud Supabase URL and unlabeled targets. Synthetic in-process only by default.
 *
 * Usage:
 *   node scripts/vel-payment-concurrency-capacity-load.mjs
 * Optional:
 *   VELORA_LOAD_ALLOW_DOCKER_SQL=1  — only if docker container label matches (still no Paymob network)
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const ROOT = resolve(process.cwd());
const OUT = resolve(ROOT, "artifacts/VEL-PAYMENT-CONCURRENCY-CAPACITY-01");
const STOP = {
  maxMs: 30_000,
  maxErrors: 5,
  concurrency: 32,
  iterations: 200,
};

function loadEnvLocalUrlHost() {
  const p = resolve(ROOT, ".env.local");
  if (!existsSync(p)) return { present: false, host: null, loopback: false, cloud: false };
  const line = readFileSync(p, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="));
  if (!line) return { present: true, host: null, loopback: false, cloud: false };
  const raw = line.slice("NEXT_PUBLIC_SUPABASE_URL=".length).trim().replace(/^"|"$/g, "");
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const cloud = host.endsWith(".supabase.co");
    return { present: true, host, loopback, cloud };
  } catch {
    return { present: true, host: "unparseable", loopback: false, cloud: false };
  }
}

function dockerLocalOk() {
  try {
    const names = execFileSync("docker", ["ps", "--format", "{{.Names}}"], {
      encoding: "utf8",
    });
    return names.split(/\r?\n/).includes("velora-access-local-20261006");
  } catch {
    return false;
  }
}

/** Synthetic CPU+async concurrency (no network, no DB). */
async function runInProcessLoad() {
  const errors = [];
  const latencies = [];
  const start = performance.now();
  let completed = 0;

  async function one(i) {
    const t0 = performance.now();
    try {
      // Simulate purchase-purpose key + hash work
      const key = `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|initial_subscribe|plan|${i % 7}`;
      createHash("sha256").update(key).digest("hex");
      await new Promise((r) => setImmediate(r));
      latencies.push(performance.now() - t0);
      completed += 1;
    } catch (e) {
      errors.push(String(e?.message ?? e));
    }
  }

  const queue = [];
  for (let i = 0; i < STOP.iterations; i++) {
    if (performance.now() - start > STOP.maxMs) break;
    if (errors.length >= STOP.maxErrors) break;
    queue.push(one(i));
    if (queue.length >= STOP.concurrency) {
      await Promise.all(queue.splice(0, queue.length));
    }
  }
  await Promise.all(queue);
  const elapsed = performance.now() - start;
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? null;
  return {
    kind: "in_process_synthetic",
    completed,
    concurrency: STOP.concurrency,
    iterationsRequested: STOP.iterations,
    elapsedMs: Math.round(elapsed),
    p95Ms: p95 == null ? null : Math.round(p95 * 1000) / 1000,
    errors: errors.length,
    errorSamples: errors.slice(0, 3),
  };
}

mkdirSync(OUT, { recursive: true });
const envHost = loadEnvLocalUrlHost();
const dockerOk = dockerLocalOk();

const report = {
  package: "VEL-PAYMENT-CONCURRENCY-CAPACITY-01",
  generatedAt: new Date().toISOString(),
  envLocalSupabase: {
    present: envHost.present,
    host: envHost.host,
    loopback: envHost.loopback,
    cloudSupabase: envHost.cloud,
  },
  dockerLocalContainer: dockerOk ? "velora-access-local-20261006" : null,
  decisions: [],
  load: null,
};

if (envHost.cloud) {
  report.decisions.push({
    code: "REFUSE_APP_ENV_LOAD",
    reason:
      "NEXT_PUBLIC_SUPABASE_URL points at *.supabase.co — treating as non-isolated. No HTTP/DB load via app env.",
  });
}

if (!dockerOk) {
  report.decisions.push({
    code: "DOCKER_LOCAL_NOT_RUNNING",
    reason: "Labeled container velora-access-local-20261006 not running — SQL load NOT_RUN.",
  });
}

// Always safe: in-process synthetic
report.load = await runInProcessLoad();
report.decisions.push({
  code: "RAN_IN_PROCESS_SYNTHETIC",
  reason: "No network; not a Vercel/Supabase capacity claim.",
});

if (process.env.VELORA_LOAD_ALLOW_DOCKER_SQL === "1" && dockerOk) {
  report.decisions.push({
    code: "DOCKER_SQL_OPT_IN_SKIPPED_IN_HARNESS",
    reason:
      "Opt-in flag set but this harness keeps SQL stress in dedicated settlement artifacts; not duplicated here.",
  });
}

writeFileSync(resolve(OUT, "load-run.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, load: report.load, decisions: report.decisions }, null, 2));
if (envHost.cloud) {
  console.error("NOTE: App .env.local is cloud-bound — external load NOT executed (correct).");
  process.exitCode = 0;
}

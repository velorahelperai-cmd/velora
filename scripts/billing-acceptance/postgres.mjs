import { execFile, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

// Deliberately no remote URL, TCP port, cloud credential or persistent volume.
const customContainer = process.env.BILLING_ACCEPTANCE_CONTAINER;
if (customContainer && (!/^velora-paymob-hosted-[a-f0-9]{8}$/.test(customContainer) || !/^[a-f0-9]{64}$/.test(process.env.BILLING_ACCEPTANCE_CONTAINER_ID ?? ""))) throw Error("Invalid pinned ephemeral acceptance target");
export const CONTAINER = customContainer ?? "velora-c2-runtime-13861eb";
export const DB = "billing_acceptance";
export const exec = promisify(execFile);
export const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const psql = ["exec", "-i", "-u", "postgres", CONTAINER, "psql", "-X", "-U", "supabase_admin", "-d", DB, "-Atq", "-v", "ON_ERROR_STOP=1"];

export async function verifyLocalContainer() {
  const { stdout } = await exec("docker", ["inspect", CONTAINER]);
  const info = JSON.parse(stdout)[0];
  if (!info.State.Running || (customContainer && info.Id !== process.env.BILLING_ACCEPTANCE_CONTAINER_ID) || info.Config.Labels?.["velora.task"] !== "c2-runtime-integration" ||
      info.HostConfig.NetworkMode !== "none" || !info.HostConfig.Tmpfs?.["/var/lib/postgresql/data"] ||
      Object.keys(info.HostConfig.PortBindings ?? {}).length || info.Mounts.some(m => m.Type !== "tmpfs")) {
    throw new Error("Refusing SQL outside this task's isolated ephemeral PostgreSQL container");
  }
  return info.Config.Image;
}

export function session(query, applicationName = "acceptance_query", { keepOpen = false } = {}) {
  // Each invocation is a separate real PostgreSQL backend. Concurrency tests
  // additionally assert distinct PIDs and observed pg_stat_activity lock waits.
  const child = spawn("docker", psql, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (part) => { stdout += part.toString(); });
  child.stderr.on("data", (part) => { stderr += part.toString(); });
  const done = new Promise((ok, fail) => {
    child.on("error", fail);
    child.on("close", (code) => code === 0 ? ok(stdout.trim()) : fail(new Error(stderr || `psql exited ${code}`)));
  });
  const input = `SET application_name=${lit(applicationName)};\n${query}\n`;
  if (keepOpen) child.stdin.write(input); else child.stdin.end(input);
  return { child, done };
}

export async function sql(query, applicationName) {
  return session(query, applicationName).done;
}
export async function rows(query) {
  return JSON.parse(await sql(`SELECT coalesce(jsonb_agg(q), '[]'::jsonb) FROM (${query}) q;`));
}
export async function file(path) { return sql(readFileSync(resolve(path), "utf8")); }

export const P1 = "20261008080000_vel_billing_p1_dependencies_d1_to_d5.sql";
// P1/P2 financial acceptance snapshot ends at receipt immutability. Later
// application-wide subscription/Meta migrations need their own dependency fixture.
export function billingMigrations() {
  return readdirSync(resolve("supabase/migrations"))
    .filter((name) => /(?:billing|paymob|subscription)/.test(name) ||
      (name >= "20261006180000" && name <= "20261007010000_vel_paymob_test_checkout.sql"))
    .filter((name) => name <= "20261008161000_vel_billing_receipt_immutability.sql")
    .sort();
}
export async function bootstrap({ preP1Fixture, postP1Fixture, includeForward = true } = {}) {
  await verifyLocalContainer();
  if (customContainer) {
    const { stdout } = await exec("docker", ["exec", "-u", "postgres", CONTAINER, "psql", "-X", "-U", "supabase_admin", "-d", "postgres", "-Atq", "-c", "SELECT count(*) FROM pg_database WHERE datname='" + DB + "'"]);
    if (stdout.trim() !== "0") throw Error("Refusing to reset an existing acceptance database");
  } else {
  await exec("docker", ["exec", "-u", "postgres", CONTAINER, "psql", "-X", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS ${DB} WITH (FORCE);`]);
  }
  await exec("docker", ["exec", "-u", "postgres", CONTAINER, "psql", "-X", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${DB};`]);
  await file("scripts/billing-acceptance/supabase-dependency-stubs.sql");
  const applied = [];
  for (const name of billingMigrations()) {
    if (name > P1 && !includeForward) break;
    if (name === P1 && preP1Fixture) await file(preP1Fixture);
    await file(`supabase/migrations/${name}`);
    applied.push(name);
    if (name === P1 && postP1Fixture) await file(postP1Fixture);
  }
  return applied;
}

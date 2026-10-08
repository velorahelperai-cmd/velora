import { execFile, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

// Deliberately no remote URL, TCP port, cloud credential or persistent volume.
export const CONTAINER = "velora-p1p2-acceptance-485d21e";
export const DB = "billing_acceptance";
export const exec = promisify(execFile);
export const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const psql = ["exec", "-i", "-u", "postgres", CONTAINER, "psql", "-X", "-U", "postgres", "-d", DB, "-Atq", "-v", "ON_ERROR_STOP=1"];

export async function verifyLocalContainer() {
  const { stdout } = await exec("docker", ["inspect", CONTAINER]);
  const info = JSON.parse(stdout)[0];
  if (info.Config.Labels?.["velora.task"] !== "p1-p2-security-acceptance" ||
      info.HostConfig.NetworkMode !== "none" || !info.HostConfig.Tmpfs?.["/var/lib/postgresql/data"]) {
    throw new Error("Refusing SQL outside this task's isolated ephemeral PostgreSQL container");
  }
  return info.Config.Image;
}

export function session(query, applicationName = "acceptance_query") {
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
  child.stdin.end(`SET application_name=${lit(applicationName)};\n${query}\n`);
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
export function billingMigrations() {
  return readdirSync(resolve("supabase/migrations"))
    .filter((name) => /(?:billing|paymob|subscription)/.test(name) ||
      (name >= "20261006180000" && name <= "20261007010000_vel_paymob_test_checkout.sql"))
    .sort();
}
export async function bootstrap({ preP1Fixture, postP1Fixture, includeForward = true } = {}) {
  await verifyLocalContainer();
  await exec("docker", ["exec", "-u", "postgres", CONTAINER, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS ${DB} WITH (FORCE);`]);
  await exec("docker", ["exec", "-u", "postgres", CONTAINER, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${DB};`]);
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

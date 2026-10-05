/**
 * Applies VEL-005A SQL to the linked cloud project.
 * Requires one of:
 * - SUPABASE_DB_URL (postgres connection string)
 * - SUPABASE_ACCESS_TOKEN (Management API personal access token)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvLocal();

const sqlPath = resolve(process.cwd(), "supabase/migrations/20261004070000_vel005a_companies.sql");
const sql = readFileSync(sqlPath, "utf8");
const ref = (process.env.SUPABASE_PROJECT_REF || "").trim();

async function viaManagementApi(token) {
  if (!ref) {
    throw new Error("Missing SUPABASE_PROJECT_REF in .env.local for Management API apply");
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${body}`);
  }
  console.log("Applied migration via Management API");
}

async function viaDbUrl(dbUrl) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Applied migration via SUPABASE_DB_URL");
  } finally {
    await client.end();
  }
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const dbUrl = process.env.SUPABASE_DB_URL;

try {
  if (dbUrl) {
    await viaDbUrl(dbUrl);
  } else if (token) {
    await viaManagementApi(token);
  } else {
    console.error(
      "Missing SUPABASE_DB_URL or SUPABASE_ACCESS_TOKEN. Add one to .env.local then rerun: node scripts/apply-vel005a.mjs",
    );
    process.exit(2);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

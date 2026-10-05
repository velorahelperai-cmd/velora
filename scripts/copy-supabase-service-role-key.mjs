/**
 * Copy SUPABASE_SERVICE_ROLE_KEY from .env.local to the clipboard for Netlify.
 * Prints shape metadata only — never prints the key.
 *
 * Usage: node scripts/copy-supabase-service-role-key.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function loadEnv() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    console.error("Missing .env.local");
    process.exit(1);
  }
  const map = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    map[line.slice(0, i).trim()] = v;
  }
  return map;
}

const key = (loadEnv().SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!key) {
  console.error("SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
if (key === ".env.local") {
  console.error(
    "Refusing to copy: value is the filename .env.local (this is what broke Netlify secrets scanning).",
  );
  process.exit(1);
}

const parts = key.split(".");
let role = null;
if (parts.length === 3) {
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    role = JSON.parse(json).role ?? null;
  } catch {
    role = null;
  }
}

if (role !== "service_role") {
  console.error(
    `Refusing to copy: JWT role is ${role ?? "unknown"}, expected service_role`,
  );
  process.exit(1);
}

const ps = spawnSync(
  "powershell",
  ["-NoProfile", "-Command", "Set-Clipboard -Value $input"],
  { input: key, encoding: "utf8" },
);
if (ps.status !== 0) {
  console.error(ps.stderr || "Clipboard copy failed");
  process.exit(1);
}

console.log(
  JSON.stringify({
    copied: true,
    len: key.length,
    jwtParts: parts.length,
    role,
    hint: "Paste into Netlify → Site configuration → Environment variables → SUPABASE_SERVICE_ROLE_KEY (scopes: Builds + Functions). Do not paste .env.local.",
  }),
);

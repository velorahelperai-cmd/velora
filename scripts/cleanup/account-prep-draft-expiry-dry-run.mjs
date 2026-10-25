#!/usr/bin/env node
/**
 * DEC-PREP-SERVER-DRAFT-001 Phase C — dry-run expiry listing only.
 * Does NOT delete Production rows. Requires separate owner approval + scoped
 * results review before any destructive cleanup.
 *
 * Usage (service role; never print secrets):
 *   node scripts/cleanup/account-prep-draft-expiry-dry-run.mjs [--limit=100]
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or project-standard equivalents).
 * Output: count + draft_id/account_id/version/expires_at only — no payload fields (LOG-001).
 */
import process from "node:process";

function parseLimit(argv) {
  const flag = argv.find((a) => a.startsWith("--limit="));
  if (!flag) return 100;
  const n = Number(flag.slice("--limit=".length));
  return Number.isFinite(n) ? Math.max(1, Math.min(500, Math.trunc(n))) : 100;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(JSON.stringify({ ok: false, code: "MISSING_ENV", name }));
    process.exit(2);
  }
  return value;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/account_prep_draft_expiry_dry_run`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ p_limit: limit }),
  });

  if (!response.ok) {
    console.error(JSON.stringify({
      ok: false,
      code: "RPC_FAILED",
      status: response.status,
      // body omitted — may contain provider detail; keep closed
    }));
    process.exit(1);
  }

  const body = await response.json();
  if (!body || body.ok !== true || body.mode !== "dry_run") {
    console.error(JSON.stringify({ ok: false, code: "UNEXPECTED_RECEIPT" }));
    process.exit(1);
  }

  // Redacted receipt: ids + timestamps only
  const candidates = Array.isArray(body.candidates)
    ? body.candidates.map((row) => ({
        draft_id: row.draft_id,
        account_id: row.account_id,
        version: row.version,
        state: row.state,
        created_at: row.created_at,
        expires_at: row.expires_at,
        linked_order_id: row.linked_order_id ?? null,
      }))
    : [];

  console.log(JSON.stringify({
    ok: true,
    mode: "dry_run",
    count: body.count ?? candidates.length,
    candidates,
    note: "Production delete NOT performed. Separate owner approval required after reviewing this scope.",
  }));
}

main().catch(() => {
  console.error(JSON.stringify({ ok: false, code: "UNAVAILABLE" }));
  process.exit(1);
});

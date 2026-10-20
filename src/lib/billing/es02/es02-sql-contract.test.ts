/**
 * Migration footprint contract (no DB apply). Codex runs native SQL separately.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

it("optional branch-contact migration validates before writes and does not widen privileges", () => {
  const sql = readFileSync("supabase/migrations/20261019172428_es02_optional_branch_contact_phone.sql", "utf8");
  expect(sql).toContain("add column contact_phone text");
  expect(sql).toContain("company_branches_contact_phone_e164");
  expect(sql.indexOf("Every optional branch contact")).toBeLessThan(sql.indexOf("update private.es02_account_orders"));
  expect(sql).toContain("contact_phone = nullif");
  expect(sql).toContain("private.es02_require_active_actor");
  expect(sql).toContain("if o.status is distinct from 'settled'");
  expect(sql).not.toMatch(/^\s*(grant|revoke)\b/im);
  expect(sql).not.toContain("disable row level security");
});

const delivery = "supabase/migrations/20261017120000_es02_account_bound_purchase.sql";
const c1 = "supabase/migrations/20261017130000_es02_c1_authority_correction.sql";
const c2 = "supabase/migrations/20261017140000_es02_c2_atomicity_ledger_snapshot.sql";

describe("es02 SQL migration contract", () => {
  const base = readFileSync(delivery, "utf8");
  const correction = readFileSync(c1, "utf8");
  const atomic = readFileSync(c2, "utf8");

  it("C2 validates all branches before writes and fail-closes stuck provisioning", () => {
    expect(atomic).toContain("Validate EVERY branch before any write");
    expect(atomic).toContain("RECONCILIATION_REQUIRED");
    expect(atomic).toMatch(/for idx in 0\.\.branch_count-1 loop/);
    expect(atomic).toContain("C1 partial / stuck provisioning");
  });

  it("C2 requires ledger bind with order environment and no catch-ignore success", () => {
    expect(atomic).toContain("insert into public.billing_subscriptions(company_id, environment, status, paid_through)");
    expect(atomic).toContain("on conflict (company_id, environment) where environment in ('test', 'live')");
    expect(atomic).toContain("ES02_LEDGER_BIND_FAILED");
    expect(atomic).not.toMatch(/exception when others then\s+null/i);
  });

  it("C2 preserves immutable stored snapshot and denies catalog laundering", () => {
    expect(atomic).toContain("private.es02_order_catalog_consistent");
    expect(atomic).toContain("'amountBaisa', o.amount_baisa");
    expect(atomic).toContain("never replace with current catalog total");
  });

  it("C2 requires broker footprint and restores account_id/client_op_id unique", () => {
    expect(atomic).toContain("private.es02_authority_footprint_ok");
    expect(atomic).toContain("es02_account_orders_account_id_client_op_id_key");
    expect(atomic).toContain("vel_broker_sessions");
    expect(atomic).not.toMatch(/when broker registry is present/i);
  });

  it("C1 predecessor retains catalog slot resolve; delivery remains additive", () => {
    expect(correction).toContain("private.es02_catalog_slot");
    expect(base).toContain("private.es02_account_orders");
    expect(base).toContain("set search_path = ''");
  });
});

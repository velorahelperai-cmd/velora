import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parsePaidBranchConnectionRead,
  type PaidBranchConnectionScope,
} from "./paid-branch-connection-contracts";

const scope: PaidBranchConnectionScope = {
  expectedAccountId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  branchId: "33333333-3333-4333-8333-333333333333",
  channel: "whatsapp",
};

const migration = readFileSync(
  "supabase/migrations/20261020012749_es02_b3_branch_channel_connection.sql",
  "utf8",
);

function slice(from: string, to: string) {
  const start = migration.indexOf(from);
  const end = migration.indexOf(to, start + from.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

function read(connection: Record<string, unknown>, sourceStatus: "ready" | "unavailable" = "ready") {
  return parsePaidBranchConnectionRead({
    schemaVersion: 1,
    sourceStatus,
    expectedAccountId: scope.expectedAccountId,
    companyId: scope.companyId,
    branchId: scope.branchId,
    channel: scope.channel,
    asOf: "2026-10-20T00:00:00.000000Z",
    revision: sourceStatus === "ready" ? "0" : null,
    connection,
  }, scope);
}

const attempt = {
  id: "44444444-4444-4444-8444-444444444444",
  generation: 1,
  expiresAt: "2026-10-20T00:10:00.000000Z",
  status: "unknown",
};

describe("branch connection capability deny and unknown recovery", () => {
  it("denies every capability when selection is missing", () => {
    const parsed = read({ state: "not_connected", flow: null, attempt: null, link: null, verified: false, reasonCodes: ["selection_required"] });
    expect(parsed?.capabilities).toEqual({ canStart: false, canRecover: false, canCancel: false, allowedFlows: [] });
  });

  it("denies every capability when the channel is not selected", () => {
    const parsed = read({ state: "not_connected", flow: null, attempt: null, link: null, verified: false, reasonCodes: ["channel_not_selected"] });
    expect(parsed?.capabilities).toEqual({ canStart: false, canRecover: false, canCancel: false, allowedFlows: [] });
  });

  it("keeps an unpaid unavailable read from recovering an unknown attempt", () => {
    const parsed = read({
      state: "unavailable",
      flow: "wa_new_number",
      attempt,
      link: null,
      verified: false,
      reasonCodes: ["unpaid"],
    }, "unavailable");
    expect(parsed?.capabilities.canRecover).toBe(false);
    expect(parsed?.capabilities.canStart).toBe(false);
  });

  it("allows recover of an unknown attempt and still denies start", () => {
    const parsed = read({
      state: "reconciliation_required",
      flow: "wa_coexistence",
      attempt,
      link: null,
      verified: false,
      reasonCodes: ["reconciliation_required"],
    });
    expect(parsed?.capabilities.canRecover).toBe(true);
    expect(parsed?.capabilities.canStart).toBe(false);
    expect(parsed?.capabilities.canCancel).toBe(false);
    expect(parsed?.capabilities.allowedFlows).toEqual([]);
  });

  it("denies unknown recovery when a hard deny code is also present", () => {
    const parsed = read({
      state: "reconciliation_required",
      flow: "wa_new_number",
      attempt,
      link: null,
      verified: false,
      reasonCodes: ["reconciliation_required", "suspended"],
    });
    expect(parsed?.capabilities).toEqual({ canStart: false, canRecover: false, canCancel: false, allowedFlows: [] });
  });
});

describe("working migration security predicates", () => {
  it("reuses the full paid entitlement checks", () => {
    const paid = slice("create function private.es02_b3_current_binding", "create function private.es02_b3_session_open");
    for (const marker of [
      "setup_file_destruction_at",
      "es02_account_provisioning",
      "es02_order_catalog_consistent",
      "es02_activation_foundation",
      "es02_catalog_slot",
      "selection_required",
      "channel_not_selected",
    ]) {
      expect(paid).toContain(marker);
    }
    expect(paid.indexOf("order by r.order_id, r.slot_index")).toBeLessThan(paid.indexOf("select count(*) into rights_count"));
    expect(paid).not.toMatch(/count\(\*\)[\s\S]{0,40}for update/i);
  });

  it("binds service phases to the broker lineage and current identity session", () => {
    const session = slice("create function private.es02_b3_session_open", "create function private.es02_b3_unavailable");
    expect(session).toContain("master_identity_session_current");
    expect(session).toContain("vel_broker_browser_lineages");
    expect(session).toContain("vel_broker_sessions");
    expect(migration).not.toContain("request.jwt.claims");
    expect(migration).not.toContain("set_config");
  });

  it("does not treat a missing selection as a ready connection", () => {
    const readFn = slice("create function public.es02_b3_read_owned_branch_connection", "create function public.es02_b3_start_owned_branch_connection");
    expect(readFn).not.toContain("selection_required', 'channel_not_selected'");
    expect(readFn).toContain("es02_b3_current_binding");
    expect(readFn).toContain("es02_b3_pin_matches");
  });

  it("revalidates paid entitlement before a bound finalize return and on recover", () => {
    const finalize = slice("create function public.es02_b3_finalize_owned_branch_connection", "create function public.es02_b3_recover_owned_branch_connection");
    const recover = slice("create function public.es02_b3_recover_owned_branch_connection", "create function public.es02_b3_cancel_owned_branch_connection");
    expect(finalize.indexOf("es02_b3_current_binding")).toBeGreaterThan(0);
    expect(finalize.indexOf("es02_b3_current_binding")).toBeLessThan(finalize.indexOf("a.status = 'bound'"));
    expect(finalize.indexOf("es02_b3_session_open")).toBeLessThan(finalize.indexOf("for update"));
    expect(finalize).not.toContain("coalesce(link_generation, 1)");
    expect(recover).toContain("es02_b3_current_binding");
    expect(recover.indexOf("es02_b3_session_open")).toBeLessThan(recover.indexOf("for share"));
  });

  it("resolves an identical client operation before the revision gate and pins the paid binding", () => {
    const start = slice("create function public.es02_b3_start_owned_branch_connection", "create function public.es02_b3_claim_owned_branch_connection");
    expect(start.indexOf("client_op_id = p_client_op_id")).toBeLessThan(start.indexOf("stale_scope"));
    expect(start).toContain("selection_id");
    expect(start).toContain("paid_fingerprint");
    expect(start).toContain("attempt_generation");
    expect(start).not.toContain("select generation from private.instagram_company_generations");
    expect(migration).toContain("company member, company, branch, order, provisioning, foundation, slot right, selection");
  });

  it("classifies a hidden attempt only after the active actor and session lineage", () => {
    const classify = slice("create function public.es02_b3_classify_instagram_attempt", "alter function private.es02_b3_current_binding");
    expect(classify.indexOf("kind', 'legacy'")).toBeLessThan(classify.indexOf("es02_require_active_actor"));
    expect(classify).toContain("es02_b3_session_open");
    expect(classify).toContain("a.session_id is distinct from sid");
    expect(classify).toContain("m.role = 'owner'");
    expect(classify).toContain("m.status = 'active'");
    expect(classify.indexOf("company_members")).toBeGreaterThan(classify.indexOf("es02_b3_session_open"));
    expect(classify.indexOf("company_members")).toBeLessThan(classify.indexOf("kind', 'branch'"));
    expect(classify).toContain("kind', 'unavailable'");
    const legacyReturn = classify.indexOf("kind', 'legacy'");
    const branchReturn = classify.indexOf("kind', 'branch'");
    expect(classify.indexOf("es02_require_active_actor")).toBeGreaterThan(legacyReturn);
    expect(classify.indexOf("es02_require_active_actor")).toBeLessThan(branchReturn);
  });

  it("pins native generation, non-expiring authorization, both coexistence proofs, and the subscription", () => {
    const project = slice("create function private.es02_b3_project", "create function private.es02_b3_launch");
    expect(project).toContain("authorization_non_expiring");
    expect(project).toContain("inbound_tested_at");
    expect(project).toContain("outbound_tested_at");
    expect(project).toContain("instagram_subscription_attempts");
    expect(project).toContain("wa.generation = link.legacy_generation");
    expect(project).toContain("ig.contract_id is not distinct from attempt.contract_id");
    expect(project).not.toContain("coalesce(link.legacy_generation, 1)");
  });
});

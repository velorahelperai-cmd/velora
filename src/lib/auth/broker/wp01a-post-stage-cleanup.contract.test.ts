/**
 * WP01A post-stage cleanup — contract definitions only.
 * Cursor prepares; Codex runs on the authorized isolated local fixture after
 * owner approval of DIAGNOSTICS deletion inventory. Not Production.
 *
 * Phase A: deny-stub retirement (continuity cutover).
 * Phase B+: ES02–ES05 object retirement — blocked until named data-loss approval.
 */

import { describe, expect, it } from "vitest";

const PHASE_A_APPROVAL = "WP01A-POST-STAGE-PHASE-A";

/** Signatures Phase A must remove (no parallel deny fallback). */
export const PHASE_A_RETIRED_SIGNATURES = [
  "public.vel_broker_issue_browser_attempt(uuid,bigint)",
  "public.vel_broker_bind_browser_attempt(uuid)",
  "public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,uuid,text,text,text)",
] as const;

/** Live WP01A / native gates that Phase A must preserve. */
export const PHASE_A_PRESERVED_SIGNATURES = [
  "public.vel_broker_bind_browser_continuity(text)",
  "public.vel_broker_lookup_browser_continuity(text)",
  "public.vel_broker_resolve_bound_session(text,text[],text)",
  "public.vel_broker_complete_revocation_operation(uuid,text)",
  "public.check_app_session(boolean)",
  "public.app_session_is_valid()",
  "public.master_revoke_account_sessions(uuid)",
] as const;

/** Auth / financial / audit classes never dropped by this cleanup package. */
export const NEVER_DROP_RELATIONS = [
  "auth.users",
  "auth.sessions",
  "auth.refresh_tokens",
  "auth.identities",
  "public.companies",
  "public.company_members",
  "public.billing_orders",
  "public.billing_payment_attempts",
  "public.billing_provider_events",
  "public.billing_entitlement_applications",
  "public.billing_subscriptions",
] as const;

/** Nine Auth-scope-excluded installers — Phase B candidates only after approval. */
export const PHASE_B_INSTALLERS = [
  "20261014033008_master_autorenew_wallet.sql",
  "20261014033010_master_knowledge_import.sql",
  "20261014033011_master_business_archive.sql",
  "20261014033012_master_admin_cycle_costs.sql",
  "20261014040120_smart_channel_independent_review.sql",
  "20261014051045_enterprise_business_lifecycle_guard.sql",
  "20261014080108_smart_setup_foundation.sql",
  "20261014080155_smart_profile_and_branch_attempts_v2.sql",
  "20261014080217_smart_review_native_scope.sql",
] as const;

describe("WP01A post-stage cleanup contracts (definitions)", () => {
  it("CL01: Phase A approval token is exact and distinct from Phase B", () => {
    expect(PHASE_A_APPROVAL).toBe("WP01A-POST-STAGE-PHASE-A");
    expect(PHASE_A_APPROVAL.includes("PHASE-B")).toBe(false);
  });

  it("CL02: Phase A retires only continuity-replaced deny stubs", () => {
    expect(PHASE_A_RETIRED_SIGNATURES).toHaveLength(3);
    expect(PHASE_A_RETIRED_SIGNATURES.join("\n")).not.toMatch(/check_app_session|admit_bound|complete_revocation/);
  });

  it("CL03: preserved set covers login/session/tenant-critical RPCs", () => {
    for (const sig of PHASE_A_PRESERVED_SIGNATURES) {
      expect(sig.startsWith("public.")).toBe(true);
    }
    expect(NEVER_DROP_RELATIONS).toContain("auth.users");
    expect(NEVER_DROP_RELATIONS).toContain("public.billing_orders");
    expect(NEVER_DROP_RELATIONS).toContain("public.company_members");
  });

  it("CL04: Phase B installer list matches Auth-scope skip set (9)", () => {
    expect(PHASE_B_INSTALLERS).toHaveLength(9);
    expect(PHASE_B_INSTALLERS.every((n) => n.endsWith(".sql"))).toBe(true);
  });

  it("CL05: Phase B approval token and SQL package path are distinct from auto-migrations", () => {
    expect("WP01A-POST-STAGE-PHASE-B").not.toBe(PHASE_A_APPROVAL);
    expect(PHASE_B_INSTALLERS.some((n) => n.includes("wp01a"))).toBe(false);
  });
});

/**
 * Codex-only SQL harness expectations (NotRun until approved local apply):
 *
 * CL-A01: without velora.cleanup_approval → CLEANUP_APPROVAL_REQUIRED
 * CL-A02: with Phase A approval → retired signatures absent (to_regprocedure null)
 * CL-A03: preserved signatures present; NEVER_DROP_RELATIONS still to_regclass
 * CL-A04: DB01–DB18b-r4 + native session/idle/revoke still Pass on Auth fixture
 * CL-A05: rollback/restore: new fixture without Phase A still has deny stubs for mixed-client
 * CL-B00: Phase B migration must not exist until named data-loss approval per table
 */
export const CODEX_CLEANUP_ACCEPTANCE_IDS = [
  "CL-A01",
  "CL-A02",
  "CL-A03",
  "CL-A04",
  "CL-A05",
  "CL-B00",
] as const;

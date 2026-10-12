import { describe, expect, it } from "vitest";
import {
  COMPANY_CAPABILITIES,
  DEFAULT_COMPANY_CAPABILITIES,
  PLATFORM_CAPABILITIES,
  accessMigrationCompatEnabled,
  controlActionCapability,
  isCompanyCapability,
  isPlatformCapability,
} from "./capabilities";

describe("access capability catalogs (FIX)", () => {
  it("keeps platform and company catalogs disjoint fixed sets", () => {
    expect(PLATFORM_CAPABILITIES).toContain("platform.manage_admins");
    expect(COMPANY_CAPABILITIES).toContain("wa.conversations.reply");
    expect(COMPANY_CAPABILITIES).toContain("wa.conversations.assign");
    expect(COMPANY_CAPABILITIES).toContain("company.staff.manage");
    for (const cap of PLATFORM_CAPABILITIES) {
      expect(isCompanyCapability(cap)).toBe(false);
      expect(isPlatformCapability(cap)).toBe(true);
    }
  });

  it("excludes unimplemented caps from grantable catalog", () => {
    expect(isCompanyCapability("reports.read")).toBe(false);
    expect(isCompanyCapability("wa.conversations.handoff")).toBe(false);
    expect(COMPANY_CAPABILITIES).not.toContain("reports.read");
  });

  it("maps control actions including assign to dedicated capabilities", () => {
    expect(controlActionCapability("take_over")).toBe("wa.conversations.take_over");
    expect(controlActionCapability("resume")).toBe("wa.conversations.resume");
    expect(controlActionCapability("close")).toBe("wa.conversations.close");
    expect(controlActionCapability("assign")).toBe("wa.conversations.assign");
  });

  it("compat flag is explicit env only (never default on)", () => {
    expect(accessMigrationCompatEnabled()).toBe(process.env.VEL_ACCESS_MIGRATION_COMPAT === "1");
  });
});

/** Pure helpers mirroring SQL grant source rules — direct bypass tests without DB. */
export function evaluateStaffGrant(input: {
  membershipActive: boolean;
  membershipRole: "owner" | "staff" | null;
  grantActive: boolean;
  capabilities: string[];
  capability: string;
  managerUserId: string | null;
  managerStillDelegatedWithCap: boolean;
  conversationScope: "all_company" | "assigned_only" | null;
  assignedTo: string | null;
  actorUserId: string;
}): { hasCap: boolean; canReadConversation: boolean } {
  if (!input.membershipActive || !input.membershipRole) {
    return { hasCap: false, canReadConversation: false };
  }
  if (input.membershipRole === "owner") {
    return { hasCap: true, canReadConversation: true };
  }
  if (!input.grantActive || !input.capabilities.includes(input.capability)) {
    return { hasCap: false, canReadConversation: false };
  }
  if (input.managerUserId !== null && !input.managerStillDelegatedWithCap) {
    return { hasCap: false, canReadConversation: false };
  }
  const hasCap = true;
  if (input.capability !== "wa.conversations.read" && !input.capabilities.includes("wa.conversations.read")) {
    // read required separately by callers; grant evaluator for a specific cap is independent
  }
  if (input.conversationScope === null) {
    return { hasCap, canReadConversation: false };
  }
  if (input.conversationScope === "all_company") {
    return { hasCap, canReadConversation: hasCap && input.capabilities.includes("wa.conversations.read") };
  }
  const canReadConversation =
    hasCap
    && input.capabilities.includes("wa.conversations.read")
    && input.assignedTo === input.actorUserId;
  return { hasCap, canReadConversation };
}

describe("grant source evaluation (FIX bypass matrix)", () => {
  const base = {
    membershipActive: true,
    membershipRole: "staff" as const,
    grantActive: true,
    capabilities: ["wa.conversations.read", "wa.conversations.reply"],
    capability: "wa.conversations.reply",
    managerUserId: null as string | null,
    managerStillDelegatedWithCap: false,
    conversationScope: "all_company" as const,
    assignedTo: null as string | null,
    actorUserId: "staff-1",
  };

  it("denies when membership inactive", () => {
    expect(evaluateStaffGrant({ ...base, membershipActive: false }).hasCap).toBe(false);
  });

  it("denies when grant missing capability", () => {
    expect(evaluateStaffGrant({ ...base, capabilities: ["wa.conversations.read"] }).hasCap).toBe(false);
  });

  it("denies dependent grant when manager delegation revoked", () => {
    expect(
      evaluateStaffGrant({
        ...base,
        managerUserId: "admin-1",
        managerStillDelegatedWithCap: false,
      }).hasCap,
    ).toBe(false);
  });

  it("allows independent owner-issued grant (manager null)", () => {
    expect(evaluateStaffGrant(base).hasCap).toBe(true);
  });

  it("allows dependent grant only while manager still delegated with cap", () => {
    expect(
      evaluateStaffGrant({
        ...base,
        managerUserId: "admin-1",
        managerStillDelegatedWithCap: true,
      }).hasCap,
    ).toBe(true);
  });

  it("assigned_only blocks unassigned conversation read", () => {
    const r = evaluateStaffGrant({
      ...base,
      capability: "wa.conversations.read",
      capabilities: ["wa.conversations.read"],
      conversationScope: "assigned_only",
      assignedTo: "other",
    });
    expect(r.hasCap).toBe(true);
    expect(r.canReadConversation).toBe(false);
  });

  it("assigned_only allows only assigned conversation", () => {
    const r = evaluateStaffGrant({
      ...base,
      capability: "wa.conversations.read",
      capabilities: ["wa.conversations.read"],
      conversationScope: "assigned_only",
      assignedTo: "staff-1",
    });
    expect(r.canReadConversation).toBe(true);
  });

  it("null scope never falls back to all_company", () => {
    const r = evaluateStaffGrant({
      ...base,
      capability: "wa.conversations.read",
      capabilities: ["wa.conversations.read"],
      conversationScope: null,
    });
    expect(r.canReadConversation).toBe(false);
  });

  it("take_over capability does not imply assign", () => {
    expect(isCompanyCapability("wa.conversations.take_over")).toBe(true);
    expect(controlActionCapability("take_over")).not.toBe("wa.conversations.assign");
    expect(
      evaluateStaffGrant({
        ...base,
        capabilities: ["wa.conversations.read", "wa.conversations.take_over"],
        capability: "wa.conversations.assign",
      }).hasCap,
    ).toBe(false);
  });

  it("delegated without scope is not treated as company grant source", () => {
    // Membership alone without grant → deny (mirrors SQL fail-closed for staff).
    expect(
      evaluateStaffGrant({
        ...base,
        grantActive: false,
        capabilities: [],
      }).hasCap,
    ).toBe(false);
  });
});

it('registers enforced IG read/assignment/reply separately and leaves new IG defaults unchecked',()=>{
 expect(COMPANY_CAPABILITIES).toContain('ig.conversations.read');
 expect(COMPANY_CAPABILITIES).toContain('ig.conversations.assign');
 expect(COMPANY_CAPABILITIES).toContain('ig.conversations.reply');
 expect(DEFAULT_COMPANY_CAPABILITIES).toHaveLength(12);
 expect(DEFAULT_COMPANY_CAPABILITIES).not.toContain('ig.conversations.reply');
 expect(COMPANY_CAPABILITIES).not.toContain('ig.connection.manage');
});

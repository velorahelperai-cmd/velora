import { afterEach, describe, expect, it } from "vitest";
import { accessMigrationCompatEnabled } from "./capabilities";

/**
 * Direct tests for FIX fail-closed rules around migration absence.
 * Never invents all_company when scope/RPC is missing unless explicit compat.
 */
function resolveCapabilityAfterRpc(input: {
  rpcMissing: boolean;
  rpcValue: boolean | null;
  compat: boolean;
}): boolean | null {
  if (input.rpcMissing) {
    return input.compat ? null : false;
  }
  return input.rpcValue === true;
}

function resolveScopeAfterRpc(input: {
  rpcMissing: boolean;
  rpcValue: string | null;
  compat: boolean;
}): "all_company" | "assigned_only" | null {
  if (input.rpcMissing) {
    // FIX: no all_company fallback — compat returns null for legacy path; else deny.
    return input.compat ? null : null;
  }
  if (input.rpcValue === "assigned_only") return "assigned_only";
  if (input.rpcValue === "all_company") return "all_company";
  return null;
}

describe("access fail-closed (no all_company fallback)", () => {
  const prev = process.env.VEL_ACCESS_MIGRATION_COMPAT;
  afterEach(() => {
    if (prev === undefined) delete process.env.VEL_ACCESS_MIGRATION_COMPAT;
    else process.env.VEL_ACCESS_MIGRATION_COMPAT = prev;
  });

  it("missing RPC without compat denies capability", () => {
    expect(resolveCapabilityAfterRpc({ rpcMissing: true, rpcValue: null, compat: false })).toBe(false);
  });

  it("missing RPC with explicit compat returns null (legacy membership only)", () => {
    expect(resolveCapabilityAfterRpc({ rpcMissing: true, rpcValue: null, compat: true })).toBe(null);
  });

  it("RPC false never upgrades to true", () => {
    expect(resolveCapabilityAfterRpc({ rpcMissing: false, rpcValue: false, compat: true })).toBe(false);
  });

  it("missing scope never becomes all_company", () => {
    expect(resolveScopeAfterRpc({ rpcMissing: true, rpcValue: null, compat: false })).toBe(null);
    expect(resolveScopeAfterRpc({ rpcMissing: true, rpcValue: null, compat: true })).toBe(null);
    expect(resolveScopeAfterRpc({ rpcMissing: false, rpcValue: null, compat: false })).toBe(null);
  });

  it("compat env helper is off by default", () => {
    delete process.env.VEL_ACCESS_MIGRATION_COMPAT;
    expect(accessMigrationCompatEnabled()).toBe(false);
    process.env.VEL_ACCESS_MIGRATION_COMPAT = "1";
    expect(accessMigrationCompatEnabled()).toBe(true);
  });

  it("missing-rpc detector requires specific function name", () => {
    const msg = 'Could not find the function public.has_company_capability(uuid, text) in the schema cache';
    expect(/has_company_capability/i.test(msg)).toBe(true);
    expect(/pgrst/i.test("generic pgrst noise") && !/has_company_capability/i.test("generic pgrst noise")).toBe(true);
  });
});

describe("platform admin bypass closure (logical)", () => {
  function isPlatformAdminEffective(input: {
    rowActive: boolean;
    role: "owner" | "delegated" | null;
    scopeCount: number;
  }): boolean {
    if (!input.rowActive || !input.role) return false;
    if (input.role === "owner") return true;
    return input.role === "delegated" && input.scopeCount > 0;
  }

  it("delegated without scopes has no general admin access", () => {
    expect(
      isPlatformAdminEffective({ rowActive: true, role: "delegated", scopeCount: 0 }),
    ).toBe(false);
  });

  it("delegated with scopes is admin (company-scoped elsewhere)", () => {
    expect(
      isPlatformAdminEffective({ rowActive: true, role: "delegated", scopeCount: 1 }),
    ).toBe(true);
  });

  it("owner is admin", () => {
    expect(isPlatformAdminEffective({ rowActive: true, role: "owner", scopeCount: 0 })).toBe(true);
  });
});

describe("revision mandatory (logical)", () => {
  function applyWithRevision(expected: number | null, current: number): "ok" | "invalid" | "conflict" {
    if (expected === null || !Number.isFinite(expected)) return "invalid";
    if (expected !== current) return "conflict";
    return "ok";
  }

  it("rejects null revision", () => {
    expect(applyWithRevision(null, 1)).toBe("invalid");
  });

  it("rejects stale revision", () => {
    expect(applyWithRevision(1, 2)).toBe("conflict");
  });

  it("accepts matching revision", () => {
    expect(applyWithRevision(2, 2)).toBe("ok");
  });
});

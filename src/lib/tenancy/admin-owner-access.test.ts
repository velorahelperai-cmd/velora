import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  user: null as unknown,
  getUserError: null as unknown,
  claims: null as unknown,
  claimsError: null as unknown,
  sessionOk: true,
  sessionExpired: false,
  sessionCode: "UNAUTHENTICATED" as "UNAUTHENTICATED" | "UNAVAILABLE",
  adminRpc: false,
  platformRow: null as unknown,
  platformError: null as unknown,
  profileRow: { full_name: "Velora Admin", support_code: "ADMIN-01" },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: state.claims, error: state.claimsError }),
      getUser: async () => ({ data: { user: state.user }, error: state.getUserError }),
    },
    rpc: async (name: string) => {
      if (name === "is_platform_admin") return { data: state.adminRpc, error: null };
      return { data: null, error: null };
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => {
          if (table === "platform_admins") {
            return { data: state.platformRow, error: state.platformError };
          }
          if (table === "profiles") {
            return { data: state.profileRow, error: null };
          }
          return { data: null, error: null };
        },
        upsert: () => ({ error: null }),
      };
      return query;
    },
  }),
}));

vi.mock("@/lib/auth/session-guard", () => ({
  checkAppSession: async () =>
    state.sessionOk
      ? { ok: true }
      : { ok: false, code: state.sessionCode, expired: state.sessionExpired },
}));

import { requirePlatformAdmin, requirePlatformOwner, pathForAccess, type AccessResult } from "./access";
import type { CompanyRecord } from "./types";

const OWNER_EMAIL = "velorahelperai@gmail.com";

function setAuthUser(options: {
  id?: string;
  email?: string;
  emailConfirmed?: boolean;
  phoneConfirmed?: boolean;
  role?: "owner" | "delegated" | null;
  status?: "active" | "disabled" | null;
}) {
  const userId = options.id ?? "user-velora-owner";
  state.claims = { claims: { sub: userId } };
  state.claimsError = null;
  state.user = {
    id: userId,
    email: options.email ?? OWNER_EMAIL,
    email_confirmed_at: options.emailConfirmed ? "2026-10-01T00:00:00Z" : null,
    phone_confirmed_at: options.phoneConfirmed ? "2026-10-01T00:00:00Z" : null,
    user_metadata: { full_name: "Velora Admin" },
  };
  state.getUserError = null;
  state.adminRpc = true;
  state.platformRow =
    options.role !== undefined
      ? options.role
        ? { role: options.role, status: options.status ?? "active" }
        : null
      : { role: "owner", status: "active" };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.user = null;
  state.getUserError = null;
  state.claims = null;
  state.claimsError = null;
  state.sessionOk = true;
  state.sessionExpired = false;
  state.sessionCode = "UNAUTHENTICATED";
  state.adminRpc = false;
  state.platformRow = null;
  state.platformError = null;
});

describe("requirePlatformOwner & requirePlatformAdmin security gates", () => {
  it("grants access only to confirmed velorahelperai@gmail.com with active owner role", async () => {
    setAuthUser({ email: OWNER_EMAIL, emailConfirmed: true, role: "owner", status: "active" });
    const result = await requirePlatformAdmin();
    expect(result.ok).toBe(true);
    expect(await requirePlatformOwner()).toMatchObject({ ok: true, context: { email: OWNER_EMAIL } });
    if (result.ok) {
      expect(result.context.email).toBe(OWNER_EMAIL);
      expect(result.context.isPlatformAdmin).toBe(true);
    }
  });

  it("denies access if email is unconfirmed even if phone is confirmed", async () => {
    setAuthUser({
      email: OWNER_EMAIL,
      emailConfirmed: false,
      phoneConfirmed: true,
      role: "owner",
      status: "active",
    });
    const result = await requirePlatformAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNVERIFIED");
    }
  });

  it("denies access if email is not velorahelperai@gmail.com even with owner role in DB", async () => {
    setAuthUser({
      email: "imposter@gmail.com",
      emailConfirmed: true,
      role: "owner",
      status: "active",
    });
    const result = await requirePlatformAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("denies access to a generic delegated platform admin with confirmed email", async () => {
    setAuthUser({
      email: "staff.admin@velora.io",
      emailConfirmed: true,
      role: "delegated",
      status: "active",
    });
    const result = await requirePlatformAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("denies access if platform owner status is disabled", async () => {
    setAuthUser({
      email: OWNER_EMAIL,
      emailConfirmed: true,
      role: "owner",
      status: "disabled",
    });
    const result = await requirePlatformAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("denies access with UNAUTHENTICATED when session is expired", async () => {
    setAuthUser({ email: OWNER_EMAIL, emailConfirmed: true, role: "owner", status: "active" });
    state.sessionOk = false;
    state.sessionExpired = true;
    state.sessionCode = "UNAUTHENTICATED";

    const result = await requirePlatformAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNAUTHENTICATED");
      expect(result.sessionExpired).toBe(true);
    }
  });
});

describe("pathForAccess redirect loop prevention", () => {
  it("allows platform owner to default to /admin", () => {
    const ownerResult: AccessResult = {
      ok: true,
      context: {
        userId: "owner-1",
        email: OWNER_EMAIL,
        phone: "",
        fullName: "Velora Admin",
        supportCode: "ADMIN",
        needsProfileName: false,
        emailConfirmed: true,
        identityVerified: true,
        isPlatformAdmin: true,
        company: null,
        membership: null,
        needsCompanyContext: false,
        workspaceChoices: [],
      },
    };
    expect(pathForAccess(ownerResult, "/admin")).toBe("/admin");
    expect(pathForAccess(ownerResult, null)).toBe("/admin");
  });

  it("never directs a non-owner generic admin to /admin (breaks redirect loop)", () => {
    const nonOwnerGenericAdmin: AccessResult = {
      ok: true,
      context: {
        userId: "generic-admin-1",
        email: "delegated@synthetic.invalid",
        phone: "",
        fullName: "Generic Admin",
        supportCode: "GEN-01",
        needsProfileName: false,
        emailConfirmed: true,
        identityVerified: true,
        isPlatformAdmin: true,
        company: null,
        membership: null,
        needsCompanyContext: false,
        workspaceChoices: [],
      },
    };
    const dest = pathForAccess(nonOwnerGenericAdmin, "/admin");
    expect(dest).not.toBe("/admin");
    expect(dest.startsWith("/admin")).toBe(false);
    expect(dest).toBe("/access?code=FORBIDDEN");
  });

  it("routes a non-owner admin with a company to /app instead of /admin", () => {
    const company: CompanyRecord = {
      id: "comp-1",
      display_name: "Customer Co",
      status: "active",
      business_type: "retail",
      reply_language: "ar",
      country: "OM",
      city: "Muscat",
      hours: "9-17",
      contact_phone: "+96891234567",
      contact_email: "info@customer.om",
      created_by: "u-1",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    };
    const nonOwnerWithCompany: AccessResult = {
      ok: true,
      context: {
        userId: "generic-admin-2",
        email: "delegated@synthetic.invalid",
        phone: "",
        fullName: "Generic Admin",
        supportCode: "GEN-02",
        needsProfileName: false,
        emailConfirmed: true,
        identityVerified: true,
        isPlatformAdmin: true,
        company,
        membership: {
          company_id: "comp-1",
          user_id: "generic-admin-2",
          role: "owner",
          status: "active",
          member_name: "Generic Admin",
          created_at: "2026-10-01T00:00:00Z",
        },
        needsCompanyContext: false,
        workspaceChoices: [],
      },
    };
    const dest = pathForAccess(nonOwnerWithCompany, "/admin");
    expect(dest).not.toBe("/admin");
    expect(dest.startsWith("/admin")).toBe(false);
    expect(dest).toBe("/app");
  });
});

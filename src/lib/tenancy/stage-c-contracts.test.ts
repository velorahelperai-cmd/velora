import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const state = vi.hoisted(() => ({
  user: null as unknown,
  getUserError: null as unknown,
  claims: null as unknown,
  claimsError: null as unknown,
  sessionOk: true,
  sessionExpired: false,
  sessionCode: "UNAUTHENTICATED" as "UNAUTHENTICATED" | "UNAVAILABLE",
  platformRow: null as unknown,
  platformError: null as unknown,
  profileRow: { full_name: "Velora Admin", support_code: "ADMIN-01" },
  rpcMocks: {} as Record<string, unknown>,
  fromMocks: {} as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: state.claims, error: state.claimsError }),
      getUser: async () => ({ data: { user: state.user }, error: state.getUserError }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name in state.rpcMocks) {
        const handler = state.rpcMocks[name];
        if (typeof handler === "function") return handler(args);
        return { data: handler, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table in state.fromMocks) {
        return state.fromMocks[table];
      }
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        maybeSingle: async () => {
          if (table === "platform_admins") {
            return { data: state.platformRow, error: state.platformError };
          }
          if (table === "profiles") {
            return { data: state.profileRow, error: null };
          }
          return { data: null, error: null };
        },
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

import { adminSearchAccounts, adminUpdateCompany, adminSetCompanyStatus } from "./actions";
import { adminListChannels } from "./channels-actions";

const OWNER_EMAIL = "velorahelperai@gmail.com";

function setAuthOwner() {
  const userId = "usr-owner-id";
  state.claims = { claims: { sub: userId } };
  state.claimsError = null;
  state.user = {
    id: userId,
    email: OWNER_EMAIL,
    email_confirmed_at: "2026-10-01T00:00:00Z",
    user_metadata: { full_name: "Velora Admin" },
  };
  state.getUserError = null;
  state.platformRow = {
    user_id: userId,
    role: "owner",
    status: "active",
  };
  state.sessionOk = true;
}

function setAuthNonOwner() {
  const userId = "usr-stranger-id";
  state.claims = { claims: { sub: userId } };
  state.user = {
    id: userId,
    email: "stranger@example.com",
    email_confirmed_at: "2026-10-01T00:00:00Z",
  };
  state.platformRow = null;
  state.sessionOk = true;
}

describe("Stage C — Backend & Contract Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rpcMocks = {};
    state.fromMocks = {};
    setAuthOwner();
  });

  describe("Module 04: adminListChannels", () => {
    it("denies access to non-platform owners", async () => {
      setAuthNonOwner();
      const res = await adminListChannels();
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("FORBIDDEN");
    });

    it("fetches and aggregates WhatsApp and Instagram channels correctly", async () => {
      // Mock companies table
      state.fromMocks["companies"] = {
        select: () => ({
          data: [
            { id: "cmp-001", display_name: "مطعم المذاق العماني", status: "active" },
            { id: "cmp-002", display_name: "مقهى السحاب", status: "active" },
          ],
          error: null,
        }),
      };

      // Mock whatsapp_company_links table
      state.fromMocks["whatsapp_company_links"] = {
        select: () => ({
          data: [
            {
              id: "link-wa-1",
              company_id: "cmp-001",
              requested_display_number: "+96891112222",
              verified_display_number: "+96891112222",
              keep_on_phone: true,
              status: "verified",
              provider_phone_number_id: "phone-id-123",
              last_error_code: null,
              updated_at: "2026-10-22T00:00:00Z",
            },
          ],
          error: null,
        }),
      };

      // Mock instagram_admin_connection RPC
      state.rpcMocks["instagram_admin_connection"] = (args: Record<string, unknown>) => {
        if (args.p_company_id === "cmp-002") {
          return {
            data: {
              ok: true,
              link: {
                linkId: "link-ig-1",
                generation: 1,
                accountId: "alsahab_cafe",
              },
            },
            error: null,
          };
        }
        return { data: { ok: true, link: null }, error: null };
      };

      const res = await adminListChannels();
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.channels).toHaveLength(2);
        expect(res.data.stats.totalChannels).toBe(2);
        expect(res.data.stats.totalWhatsapp).toBe(1);
        expect(res.data.stats.totalInstagram).toBe(1);
        expect(res.data.stats.activeConnected).toBe(2);
        expect(res.data.stats.coexistenceCount).toBe(1);

        const wa = res.data.channels.find((c) => c.channelType === "whatsapp");
        expect(wa?.companyName).toBe("مطعم المذاق العماني");
        expect(wa?.coexistence).toBe(true);
        expect(wa?.status).toBe("verified");

        const ig = res.data.channels.find((c) => c.channelType === "instagram");
        expect(ig?.companyName).toBe("مقهى السحاب");
        expect(ig?.identifier).toBe("@alsahab_cafe");
      }
    });
  });

  describe("Module 03: adminSearchAccounts", () => {
    it("denies access to non-platform owners", async () => {
      setAuthNonOwner();
      const res = await adminSearchAccounts({ query: "test" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("FORBIDDEN");
    });

    it("caps limit to 50 and offset to ADMIN_ACCOUNT_SEARCH_MAX_OFFSET", async () => {
      let capturedLimit = 0;
      let capturedOffset = 0;

      state.rpcMocks["admin_search_accounts"] = (args: Record<string, unknown>) => {
        capturedLimit = args.p_limit as number;
        capturedOffset = args.p_offset as number;
        return { data: [], error: null };
      };

      const res = await adminSearchAccounts({
        query: "salim",
        limit: 100, // should cap at 50
        offset: 200000, // should cap at ADMIN_ACCOUNT_SEARCH_MAX_OFFSET (100000)
      });

      expect(res.ok).toBe(true);
      expect(capturedLimit).toBe(50);
      expect(capturedOffset).toBe(100000);
    });

    it("maps account rows and email_confirmed status properly", async () => {
      state.rpcMocks["admin_search_accounts"] = () => ({
        data: [
          {
            user_id: "usr-1",
            support_code: "VEL-01",
            full_name: "سالم الشامسي",
            email: "salim@example.com",
            account_phone: "+96899998888",
            email_confirmed: true,
            companies: [
              {
                company_id: "cmp-1",
                display_name: "منشأة الفجر",
                role: "owner",
                status: "active",
                company_status: "active",
                business_phone: "+96824000000",
              },
            ],
          },
        ],
        error: null,
      });

      const res = await adminSearchAccounts({ query: "salim" });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.rows).toHaveLength(1);
        const acc = res.data.rows[0];
        expect(acc.email_confirmed).toBe(true);
        expect(acc.full_name).toBe("سالم الشامسي");
        expect(acc.companies[0].display_name).toBe("منشأة الفجر");
      }
    });
  });

  describe("Module 02: adminUpdateCompany & adminSetCompanyStatus", () => {
    it("denies company mutation to non-platform owners", async () => {
      setAuthNonOwner();
      const resUpdate = await adminUpdateCompany({
        companyId: "cmp-001",
        displayName: "اسم جديد",
        businessType: "cafe",
        replyLanguage: "both",
        country: "OM",
        city: "مسقط",
        hours: "10:00 - 22:00",
        contactPhone: "+96891234567",
        contactEmail: "new@example.com",
      });
      expect(resUpdate.ok).toBe(false);
      if (!resUpdate.ok) expect(resUpdate.code).toBe("FORBIDDEN");

      const resStatus = await adminSetCompanyStatus("cmp-001", "suspended");
      expect(resStatus.ok).toBe(false);
      if (!resStatus.ok) expect(resStatus.code).toBe("FORBIDDEN");
    });

    it("executes update company write when authorized and returns updated record", async () => {
      state.rpcMocks["admin_update_company"] = (args: Record<string, unknown>) => ({
        data: {
          id: args.p_company_id,
          display_name: args.p_display_name,
          business_type: args.p_business_type,
          reply_language: args.p_reply_language,
          country: args.p_country,
          city: args.p_city,
          hours: args.p_hours,
          contact_phone: args.p_contact_phone,
          contact_email: args.p_contact_email,
          status: "active",
        },
        error: null,
      });

      const res = await adminUpdateCompany({
        companyId: "cmp-001",
        displayName: "مطعم الريف العماني",
        businessType: "restaurant",
        replyLanguage: "ar",
        country: "OM",
        city: "نزوى",
        hours: "08:00 - 00:00",
        contactPhone: "+96895554444",
        contactEmail: "reef@example.om",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.display_name).toBe("مطعم الريف العماني");
        expect(res.data.city).toBe("نزوى");
      }
    });

    it("executes company status change when authorized", async () => {
      state.rpcMocks["admin_set_company_status"] = (args: Record<string, unknown>) => ({
        data: {
          id: args.p_company_id,
          status: args.p_status,
          display_name: "مطعم الريف العماني",
        },
        error: null,
      });

      const res = await adminSetCompanyStatus("cmp-001", "suspended");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.status).toBe("suspended");
      }
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authContext: null as { ok: boolean; code?: string; context?: { userId: string } } | null,
  pendingReviewsMock: [] as unknown[],
  searchAccountsMock: [] as unknown[],
}));

vi.mock("@/lib/tenancy/access", () => ({
  requirePlatformOwner: vi.fn(async () => {
    return state.authContext ?? { ok: true, context: { userId: "owner-123" } };
  }),
}));

vi.mock("@/lib/tenancy/actions", () => ({
  adminListPendingReviewsPage: vi.fn(async () => ({
    ok: true,
    data: {
      rows: state.pendingReviewsMock,
      totalCount: state.pendingReviewsMock.length,
      offset: 0,
      limit: 50,
      hasMore: false,
    },
  })),
  adminSearchAccounts: vi.fn(async () => ({
    ok: true,
    data: {
      rows: state.searchAccountsMock,
      hasMore: false,
      atBrowseWindowEnd: false,
      maxOffset: 100,
    },
  })),
}));

import { adminGetSupportOverview, adminLookupCustomerByCodeOrEmail } from "./support-actions";

describe("Stage E — Module 09: support-contracts", () => {
  beforeEach(() => {
    state.authContext = null;
    state.pendingReviewsMock = [];
    state.searchAccountsMock = [];
  });

  it("denies access to non-platform owners with FORBIDDEN code", async () => {
    state.authContext = { ok: false, code: "FORBIDDEN" };
    const res = await adminGetSupportOverview();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("FORBIDDEN");
    }
  });

  it("denies unauthenticated requests with UNAUTHENTICATED code", async () => {
    state.authContext = { ok: false, code: "UNAUTHENTICATED" };
    const res = await adminGetSupportOverview();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("UNAUTHENTICATED");
    }
  });

  it("returns support overview with pending reviews and SLA channels", async () => {
    state.authContext = { ok: true, context: { userId: "owner-123" } };
    state.pendingReviewsMock = [
      {
        id: "cmp-01",
        display_name: "Al Maha Perfumes",
        business_type: "Retail",
        status: "setup",
        country: "OM",
        city: "Muscat",
        contact_phone: "+96891234567",
        contact_email: "maha@example.com",
        created_by: "usr-01",
        created_at: "2026-10-22T08:00:00Z",
        updated_at: "2026-10-22T08:00:00Z",
        owner_email: "maha@example.com",
        owner_name: "Maha",
        member_count: 2,
        review_requested_at: "2026-10-22T08:00:00Z",
      },
    ];

    const res = await adminGetSupportOverview();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.kpis.pendingReviewsCount).toBe(1);
      expect(res.data.kpis.supportSlaHours).toBe(4);
      expect(res.data.pendingReviews).toHaveLength(1);
      expect(res.data.pendingReviews[0].display_name).toBe("Al Maha Perfumes");
      expect(res.data.supportChannels.length).toBeGreaterThan(0);
    }
  });

  it("looks up customer account by Support Code via adminSearchAccounts", async () => {
    state.authContext = { ok: true, context: { userId: "owner-123" } };
    state.searchAccountsMock = [
      {
        user_id: "usr-100",
        email: "customer@example.com",
        account_phone: "+96891234567",
        full_name: "Salim Al Habsi",
        support_code: "VEL-ABCD-EFGH-1234",
        email_confirmed: true,
        companies: [{ company_id: "cmp-01", display_name: "Al Maha Perfumes" }],
      },
    ];

    const res = await adminLookupCustomerByCodeOrEmail("VEL-ABCD-EFGH-1234");
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].support_code).toBe("VEL-ABCD-EFGH-1234");
  });
});

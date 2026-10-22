import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authContext: null as { ok: boolean; code?: string; context?: { userId: string } } | null,
  companiesMock: null as { data: unknown; error: unknown } | null,
  paymobMock: [] as unknown[],
  waMock: [] as unknown[],
  igMock: [] as unknown[],
}));

vi.mock("@/lib/tenancy/access", () => ({
  requirePlatformOwner: vi.fn(async () => {
    return state.authContext ?? { ok: true, context: { userId: "owner-123" } };
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => ({
      select: () => ({
        limit: () => state.companiesMock ?? { data: [{ id: "cmp-01" }], error: null },
        order: () => ({
          limit: () => {
            if (table === "billing_provider_events") return { data: state.paymobMock, error: null };
            if (table === "whatsapp_conversation_events") return { data: state.waMock, error: null };
            if (table === "instagram_webhook_receipts") return { data: state.igMock, error: null };
            return { data: [], error: null };
          },
        }),
      }),
    }),
  })),
}));

import { adminGetOperationsOverview } from "./operations-actions";

describe("Stage E — Module 08: operations-contracts", () => {
  beforeEach(() => {
    state.authContext = null;
    state.companiesMock = null;
    state.paymobMock = [];
    state.waMock = [];
    state.igMock = [];
  });

  it("denies access to non-platform owners with FORBIDDEN code", async () => {
    state.authContext = { ok: false, code: "FORBIDDEN" };
    const res = await adminGetOperationsOverview();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("FORBIDDEN");
    }
  });

  it("denies unauthenticated requests with UNAUTHENTICATED code", async () => {
    state.authContext = { ok: false, code: "UNAUTHENTICATED" };
    const res = await adminGetOperationsOverview();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("UNAUTHENTICATED");
    }
  });

  it("returns UNKNOWN for webhook success rate and events when zero real events exist", async () => {
    state.authContext = { ok: true, context: { userId: "owner-123" } };
    state.paymobMock = [];
    state.waMock = [];
    state.igMock = [];

    const res = await adminGetOperationsOverview();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.kpis.activeIncidents).toBe(0);
      expect(res.data.kpis.webhookSuccessRate).toBe("UNKNOWN");
      expect(res.data.kpis.totalEvents).toBe("UNKNOWN");
      expect(res.data.webhookPipes[0].successRate).toBe("UNKNOWN");
      expect(res.data.recentEvents).toHaveLength(0);
    }
  });

  it("computes real operational rates and filters by correlationId end-to-end", async () => {
    state.authContext = { ok: true, context: { userId: "owner-123" } };
    state.paymobMock = [
      {
        id: "evt-pay-1",
        payment_attempt_id: "att-xyz999",
        provider_transaction_id: "txn-12345",
        company_id: "cmp-01",
        event_status: "success",
        observation_key: "charge_captured",
        created_at: "2026-10-22T08:00:00Z",
      },
      {
        id: "evt-pay-2",
        payment_attempt_id: "att-failed111",
        provider_transaction_id: "txn-67890",
        company_id: "cmp-02",
        event_status: "failed",
        observation_key: "card_declined",
        created_at: "2026-10-22T07:30:00Z",
      },
    ];
    state.waMock = [
      {
        id: "evt-wa-1",
        company_id: "cmp-01",
        conversation_id: "conv-wa-888",
        action: "take_over",
        created_at: "2026-10-22T08:15:00Z",
      },
    ];

    // Query with correlationId filter
    const res = await adminGetOperationsOverview({ correlationId: "xyz999" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.kpis.totalEvents).toBe(3);
      // 2 success (1 paymob + 1 wa) out of 3 = 67%
      expect(res.data.kpis.webhookSuccessRate).toBe("67%");
      // Only 1 event matches "xyz999"
      expect(res.data.recentEvents).toHaveLength(1);
      expect(res.data.recentEvents[0].traceId).toBe("pay-att-xyz999");
      expect(res.data.recentEvents[0].requestId).toBe("txn-12345");
    }
  });
});

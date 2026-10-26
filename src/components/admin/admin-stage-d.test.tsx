import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminAIOperations } from "./admin-ai-operations";
import { AdminBillingLedger } from "./billing-ledger";
import { AdminCatalog } from "@/components/app/admin-catalog";

const state = vi.hoisted(() => ({ locale: "ar" as "ar" | "en" }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => state }));

vi.mock("@/lib/answers/runtime/admin-actions", () => ({
  runAdminAITrial: vi.fn(),
  readAdminAIState: vi.fn(),
}));

vi.mock("@/lib/billing/catalog-backend/actions", () => ({
  readCatalogAdminAction: vi.fn(),
  saveCatalogDraftAction: vi.fn(),
  publishCatalogVersionAction: vi.fn(),
  bindNouraBasicDraftAction: vi.fn(),
}));

describe("Stage D — AI, Billing & Catalog Master Suite (Modules 05, 06, 07)", () => {
  it("Module 05: renders AI Operations dashboard with real DB cap and isolated platform owner badge", () => {
    state.locale = "ar";
    const markup = renderToStaticMarkup(
      createElement(AdminAIOperations, {
        initial: {
          budget: { limit_baisa: 25000, spent_baisa: 5000, held_baisa: 1000, enabled: true },
          companies: [{ id: "cmp-01", name: "شركة النور", status: "active" }],
          models: [
            { model_id: "gemini-3.8-flash", attempts: 50, succeeded: 49, cost_baisa: 500 },
            { model_id: "gpt-6-luna", attempts: 20, succeeded: 19, cost_baisa: 1200 },
            { model_id: "gpt-6.1-sol", attempts: 10, succeeded: 9, cost_baisa: 800 },
          ],
          recent: [],
        },
      })
    );

    // Module 05 badge & Owner verification
    expect(markup).toContain("Module 05");
    expect(markup).toContain("velorahelperai@gmail.com");
    // Real DB budget: 25.000 OMR (Must NEVER be 100 OMR)
    expect(markup).toContain("25.000");
    expect(markup).not.toContain("100.000");
    // Models registry
    expect(markup).toContain("Gemini 3.8 Flash");
    expect(markup).toContain("GPT-6 Luna");
    expect(markup).toContain("GPT-6.1 Sol");
  });

  it("Module 06: renders Billing & Payments ledger with confirmed revenue and restricted Test checkout", () => {
    state.locale = "ar";
    const markup = renderToStaticMarkup(
      createElement(AdminBillingLedger, {
        result: {
          status: "ready",
          total: 2,
          hasMore: false,
          nextCursor: null,
          snapshot: "2026-10-22T08:00:00Z",
          rows: [
            {
              id: "ord-101",
              companyId: "cmp-101",
              companyName: "مقهى مسقط",
              createdAt: "2026-10-22T06:00:00Z",
              amountBaisa: 45000,
              currency: "OMR",
              environment: "test",
              checkoutDeadline: null,
              checkoutExpired: false,
              financial: {
                companyId: "cmp-101",
                orderId: "ord-101",
                state: "proven",
                collectionProven: true,
                environment: "test",
                collectedAt: "2026-10-22T06:05:00Z",
                paidThrough: "2026-11-22T06:05:00Z",
              },
            },
          ],
        },
        query: {},
      })
    );

    // Module 06 badge
    expect(markup).toContain("Module 06");
    // restricted Test gateway
    expect(markup).toContain("Thawani UAT");
    expect(markup).not.toContain("Paymob");
    // Order row and amount
    expect(markup).toContain("مقهى مسقط");
    expect(markup).toContain("ord-101");
    expect(markup).toContain("45.000");
  });

  it("Module 07: renders Plans Catalog with Noura persona and immutable published status", () => {
    state.locale = "ar";
    const markup = renderToStaticMarkup(
      createElement(AdminCatalog, {
        initial: {
          ok: true,
          data: {
            revision: 3,
            versions: [
              {
                version_id: "ver-noura-01",
                version: 1,
                code: "noor_basic",
                currency: "OMR",
                amount_baisa: 45000,
                period_unit: "month",
                period_count: 1,
                limits: { automated_outbound_per_month: 1000, feature_availability: {} },
                status: "published",
              },
            ],
          },
        },
      })
    );

    // Catalog title & version
    expect(markup).toContain("كتالوج الاشتراكات والباقات");
    expect(markup).toContain("نورا / Standard");
    expect(markup).toContain("45.000");
    expect(markup).toContain("1,000");
  });
});

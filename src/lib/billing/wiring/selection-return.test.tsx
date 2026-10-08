import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapBillingReturnDbParts } from "./return-load";
import { subscriptionReturnHref } from "@/components/app/subscription-navigation";
import type { SubscriptionOfferView } from "@/components/app/subscription-offers-view";
import { SubscriptionPaymentStatus } from "@/components/app/subscription-payment-status";

vi.mock("@/lib/billing/wiring/test-checkout-actions", () => ({ resumeTestCheckoutAction: vi.fn() }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/app/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/app/access-gate", () => ({ AccessGate: () => null }));

const versionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const offer: SubscriptionOfferView = { versionId, planId: "plan", persona: "level_1", package: "basic", term: "monthly", amountBaisa: 45000, currency: "OMR", automatedOutboundPerMonth: 734, quotaEnforcement: "not_verified", features: [] };
const order = { id: "order", company_id: "company", status: "submitted", plan_version_id: versionId, amount_baisa: 45000, currency: "OMR" };
const row = () => mapBillingReturnDbParts("company", { order, attempt: null, latestEvent: null, grant: null });
const href = `/app/settings?tab=plan&term=monthly&persona=level_1&package=basic&version=${versionId}&amount=45000&currency=OMR`;

describe("selection after returning from payment", () => {
  it("preserves the plan version and amount from a company-scoped persisted order", () => {
    expect(row()).toMatchObject({ selection: { planVersionId: versionId, amountBaisa: 45000, currency: "OMR" } });
    expect(subscriptionReturnHref("company", row(), { status: "ready", offers: [offer] })).toBe(href);
  });
  it("does not project or link another company's order", () => {
    expect(mapBillingReturnDbParts("another-company", { order, attempt: null, latestEvent: null, grant: null })).toBeNull();
    expect(subscriptionReturnHref("another-company", row(), { status: "ready", offers: [offer] })).toBe("/app/settings?tab=plan");
  });
  it.each([
    { status: "unconfigured" as const, offers: [] },
    { status: "empty" as const, offers: [] },
    { status: "ready" as const, offers: [{ ...offer, versionId: "retired-version" }] },
    { status: "ready" as const, offers: [{ ...offer, amountBaisa: 46000 }] },
  ])("falls back when the locked order has no matching current published offer %#", catalog => {
    expect(subscriptionReturnHref("company", row(), catalog)).toBe("/app/settings?tab=plan");
  });
  it("keeps legacy rows without selection metadata compatible", () => {
    const legacy = mapBillingReturnDbParts("company", { order: { id: "order", company_id: "company", status: "submitted" }, attempt: null, latestEvent: null, grant: null });
    expect(legacy).not.toHaveProperty("selection");
    expect(subscriptionReturnHref("company", legacy, { status: "ready", offers: [offer] })).toBe("/app/settings?tab=plan");
  });
  it("renders the actual status back-link with the server-projected selection", () => {
    const markup = renderToStaticMarkup(createElement(SubscriptionPaymentStatus, { display: { kind: "verifying", messageKey: "payment_verifying" }, subscriptionHref: href }));
    expect(markup).toContain(`href="${href.replaceAll("&", "&amp;")}"`);
    expect(markup).toContain("Back to company subscription");
  });
});

const routeState = vi.hoisted(() => ({ row: null as unknown, catalog: null as unknown }));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: async () => ({ ok: true, context: { company: { id: "company" }, membership: { role: "owner" } } }) }));
vi.mock("@/lib/billing/wiring/order-event-processing", () => ({ processOwnerOrderEvents: async () => undefined }));
vi.mock("@/lib/billing/catalog-backend/rpc", () => ({ readPublicCatalogBackend: async () => routeState.catalog }));
vi.mock("./return-load", async importOriginal => {
  const original = await importOriginal<typeof import("./return-load")>();
  return { ...original, loadBillingReturnRow: async () => routeState.row };
});
import Page from "@/app/app/subscription/orders/[orderId]/page";

describe("payment return page selection props", () => {
  beforeEach(() => {
    routeState.row = row();
    routeState.catalog = { ok: true, data: [{ product_code: "velora_ai_staff", plan_id: "plan", version_id: versionId, version: 1, code: "noor_basic", persona: "noor", variant: "basic", currency: "OMR", amount_baisa: 45000, period_unit: "month", period_count: 1, automated_outbound_per_month: 734, checkout_enabled: false, feature_availability: {} }] };
  });
  it("supplies the selected back destination without trusting a success query", async () => {
    const input = { params: Promise.resolve({ orderId: versionId }), searchParams: Promise.resolve({ success: "true", amount: "1", version: "forged" }) };
    const element = await Page(input);
    expect(element.props.subscriptionHref).toBe(href);
    expect(element.props.display.kind).toBe("unresolved");
  });
  it("still renders order status when catalog navigation cannot be restored", async () => {
    routeState.catalog = { ok: false, code: "unavailable" };
    const element = await Page({ params: Promise.resolve({ orderId: versionId }) });
    expect(element.props.subscriptionHref).toBe("/app/settings?tab=plan");
    expect(element.props.display.kind).toBe("unresolved");
  });
});

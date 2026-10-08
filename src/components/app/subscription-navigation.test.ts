import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { authFlowHref, pendingSignupFromStorage, serializePendingSignup } from "@/lib/auth/auth-journey";
import { isPurchasableOffer, type SubscriptionOfferView } from "./subscription-offers-view";
import { choiceFromSubscriptionIntent, subscriptionIntentFromChoice, subscriptionIntentHref, subscriptionIntentFromParams, type SubscriptionIntent, type SubscriptionDestination } from "./subscription-navigation";
import { SubscriptionPanel } from "./subscription-panel";

const request = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(request.query) }));
vi.mock("@/lib/billing/wiring/test-checkout-actions", () => ({ startTestCheckoutAction: vi.fn() }));

const intent: SubscriptionIntent = {
  persona: "level_1", package: "basic", term: "monthly",
  versionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", amountBaisa: 45000, currency: "OMR",
};
const offer: SubscriptionOfferView = {
  versionId: intent.versionId!, planId: "plan", persona: "level_1", package: "basic", term: "monthly",
  amountBaisa: 45000, currency: "OMR", automatedOutboundPerMonth: 734,
  quotaEnforcement: "not_verified", features: [],
};
const query = "tab=plan&term=monthly&persona=level_1&package=basic&version=cccccccc-cccc-4ccc-8ccc-cccccccccccc&amount=45000&currency=OMR";
const settingsPath = `/app/settings?${query}`;

describe("selected subscription through authentication", () => {
  it("shows the restored published Basic plan as the selection in the actual account panel", () => {
    request.query = query;
    const markup = renderToStaticMarkup(createElement(SubscriptionPanel, { locale: "en", companyId: "company", view: { state: "empty", currentTier: null, cycle: null, paidThrough: null }, offersView: { status: "ready", offers: [offer] } }));
    expect(markup).toContain('data-selected="true"');
  });

  it("opens annual inspection in the actual account panel without selecting a monthly checkout offer", () => {
    request.query = "tab=plan&term=yearly&persona=level_1&package=basic";
    const markup = renderToStaticMarkup(createElement(SubscriptionPanel, { locale: "en", companyId: "company", view: { state: "empty", currentTier: null, cycle: "monthly", paidThrough: null }, offersView: { status: "ready", offers: [offer] } }));
    expect(markup).toContain('aria-pressed="true">Yearly</button>');
    expect(markup).not.toContain('data-selected="true"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="subscription-payment-note"/);
  });

  it.each([
    query.replace("amount=45000", "amount=1"),
    query.replace("persona=level_1", "persona=level_2"),
    query.replace("currency=OMR", "currency=USD"),
  ])("does not restore checkout for an altered same-version intent %s", params => {
    request.query = params;
    const markup = renderToStaticMarkup(createElement(SubscriptionPanel, { locale: "en", companyId: "company", view: { state: "empty", currentTier: null, cycle: null, paidThrough: null }, offersView: { status: "ready", offers: [offer] } }));
    expect(markup).not.toContain('data-selected="true"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="subscription-payment-note"/);
  });

  it("carries the exact selected catalog version and price into owner settings", () => {
    expect(subscriptionIntentHref({ href: "/app/settings?tab=plan", kind: "manage", note: null }, intent)).toBe(settingsPath);
    expect(subscriptionIntentFromParams(new URLSearchParams(query))).toEqual(intent);
  });

  it.each([
    ["login", "/login?reason=session_expired&next=%2Fapp"],
    ["verify", "/verify-email?email=owner%40example.com"],
    ["profile", "/complete-profile"],
    ["setup", "/setup"],
  ] as const)("preserves the selection through the %s gate", (kind, href) => {
    const result = new URL(subscriptionIntentHref({ href, kind, note: null }, intent), "https://velora.example");
    expect(result.searchParams.get("next")).toBe(settingsPath);
    expect(result.pathname).toBe(href.split("?")[0]);
    if (kind === "login") expect(result.searchParams.get("reason")).toBe("session_expired");
    if (kind === "verify") expect(result.searchParams.get("email")).toBe("owner@example.com");
  });

  it("retains package and annual inspection intent without creating a checkout choice", () => {
    const annual: SubscriptionIntent = { persona: "level_2", package: "premium", term: "yearly" };
    const href = subscriptionIntentHref({ href: "/app/settings?tab=plan", kind: "manage", note: null }, annual);
    const restored = subscriptionIntentFromParams(new URL(href, "https://velora.example").searchParams);
    expect(restored).toEqual(annual);
    expect(choiceFromSubscriptionIntent(restored, { status: "ready", offers: [offer] })).toBeNull();
    expect(isPurchasableOffer("level_2", "premium", "yearly", offer, "ready")).toBe(false);
  });

  it("keeps an annual preference even before an offer is selected", () => {
    const href = subscriptionIntentHref({ href: "/login?next=%2Fapp", kind: "login", note: null }, { term: "yearly" });
    const next = new URL(href, "https://velora.example").searchParams.get("next")!;
    expect(next).toBe("/app/settings?tab=plan&term=yearly");
    expect(subscriptionIntentFromParams(new URL(next, "https://velora.example").searchParams)).toEqual({ term: "yearly" });
  });

  it("survives signup storage, verification and login links with every selected field", () => {
    const savedAt = Date.UTC(2026, 9, 8, 12);
    const signup = serializePendingSignup({ email: "owner@example.com", next: settingsPath, savedAt });
    const pending = pendingSignupFromStorage(signup, savedAt + 1);
    const verify = new URL(authFlowHref("/verify-email", pending!.next, pending!.email), "https://velora.example");
    const login = new URL(authFlowHref("/login", verify.searchParams.get("next")), "https://velora.example");
    expect(login.searchParams.get("next")).toBe(settingsPath);
    expect(subscriptionIntentFromParams(new URL(login.searchParams.get("next")!, "https://velora.example").searchParams)).toEqual(intent);
  });

  it("requires the same published version, amount and currency to restore checkout selection", () => {
    const restored = subscriptionIntentFromParams(new URLSearchParams(query));
    const selected = choiceFromSubscriptionIntent(restored, { status: "ready", offers: [offer] });
    expect(selected).toMatchObject({ persona: "level_1", package: "basic", term: "monthly", versionId: intent.versionId });
    expect(subscriptionIntentFromChoice(selected, { status: "ready", offers: [offer] })).toEqual(intent);
    expect(choiceFromSubscriptionIntent(restored, { status: "ready", offers: [{ ...offer, amountBaisa: 46000 }] })).toBeNull();
    expect(choiceFromSubscriptionIntent(restored, { status: "ready", offers: [{ ...offer, versionId: "new-version" }] })).toBeNull();
    expect(choiceFromSubscriptionIntent(restored, { status: "empty", offers: [] })).toBeNull();
    expect(choiceFromSubscriptionIntent(restored, { status: "unconfigured", offers: [] })).toBeNull();
  });

  it("keeps long translated feature labels out of URLs and return cookies", () => {
    const largeOffer = { ...offer, features: [{ id: "faq", label: { ar: "أ".repeat(5000), en: "a".repeat(5000) }, availability: "planned" as const }] };
    const catalog = { status: "ready" as const, offers: [largeOffer] };
    const selected = choiceFromSubscriptionIntent(intent, catalog);
    const href = subscriptionIntentHref({ href: "/login?next=%2Fapp", kind: "login", note: null }, subscriptionIntentFromChoice(selected, catalog));
    expect(href.length).toBeLessThan(500);
    expect(href).not.toContain("offer=");
  });

  it.each([
    "tab=plan",
    query.replace("persona=level_1", "persona=admin"),
    query.replace("package=basic", "package=enterprise"),
    query.replace("term=monthly", "term=annual"),
    query.replace("version=cccccccc-cccc-4ccc-8ccc-cccccccccccc", "version="),
    query.replace("amount=45000", "amount=NaN"),
    query.replace("currency=OMR", "currency=USD"),
    `${query}&version=another-version`,
  ])("rejects malformed or ambiguous selection query %s", params => {
    expect(subscriptionIntentFromParams(new URLSearchParams(params))).toBeNull();
  });

  it("leaves staff, platform and denied destinations under the existing navigation gates", () => {
    const destinations: SubscriptionDestination[] = [
      { href: "/app/conversations", kind: "workspace", note: "staff" },
      { href: "/admin", kind: "platform", note: "platform" },
      { href: "/access?code=FORBIDDEN", kind: "access", note: null },
    ];
    for (const destination of destinations) expect(subscriptionIntentHref(destination, intent)).toBe(destination.href);
    expect(subscriptionIntentHref({ href: "/login?next=%2Fapp", kind: "login", note: null }, null)).toBe("/login?next=%2Fapp");
  });
});

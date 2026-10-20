import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrepaymentPreparation } from "./prepayment-preparation";
import { SetupOrderReviewView, type ViewProps } from "./setup-order-review";
import { buildReviewModel } from "./setup-order-review-model";
import { CountryCombobox } from "./country-combobox";
import { countryLabel } from "./country-options";

// Coverage moved from the retired first-business form to the current prepayment
// and explicit order-review boundaries. Existing-company setup is unchanged.
const session = vi.hoisted(() => ({ ready: true, userId: "fixture" }));
vi.mock("./account-chrome", () => ({
  AccountMenu: () => null,
  useOptionalAccountSession: () => ({
    status: session.ready ? "ready" : "loading",
    identity: { userId: session.userId },
    isCurrentUser: () => session.ready,
    liveSnapshot: () => ({ ready: session.ready, userId: session.userId, boundaryFingerprint: "capture" }),
  }),
}));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en" }) }));
vi.mock("./ui", () => ({ LangSwitch: () => null }));
const slots = [{ label: { name: "Main", city: "Muscat" }, persona: "level_1" as const, package: "basic" as const }];
const model = buildReviewModel(slots, "monthly");
const view = (over: Partial<ViewProps> = {}) => renderToStaticMarkup(createElement(SetupOrderReviewView, {
  ar: false, model, slots, phase: "ready", consent: false, locked: false,
  failureCode: null, reference: null, canRetry: false, termsHref: "/terms",
  ids: { title: "title", consent: "consent", status: "status" },
  onConsent: vi.fn(), onConfirm: vi.fn(), onRetry: vi.fn(), onEdit: vi.fn(), onBack: vi.fn(), ...over,
}));
const preparation = () => renderToStaticMarkup(createElement(PrepaymentPreparation, { userId: "fixture" }));
const action = (html: string, name: string) => html.match(new RegExp('<button[^>]*data-action="'+name+'"[^>]*>'))?.[0] ?? "";
beforeEach(() => { session.ready = true; session.userId = "fixture"; });

describe("current first-business presentation boundaries after legacy removal", () => {
  it("keeps blank preparation local and requires consent before any order confirm", () => {
    expect(preparation()).not.toContain('type="submit"');
    expect(action(view(), "confirm")).toContain('disabled=""');
    expect(action(view({ consent: true }), "confirm")).not.toContain('disabled=""');
  });
  it("does not expose editable preparation while identity is unready or mismatched", () => {
    session.ready = false;
    expect(preparation()).not.toContain('role="form"');
    session.ready = true; session.userId = "other";
    expect(preparation()).not.toContain('role="form"');
  });
  it("locks editing and Back while the explicit order operation is pending", () => {
    const html = view({ phase: "confirming", locked: true, consent: true });
    expect(action(html, "back")).toContain('disabled=""');
    expect(action(html, "edit")).toContain('disabled=""');
  });
  it("offers the same-operation UNKNOWN status check without a fresh create action", () => {
    const html = view({ phase: "unknown", locked: true, canRetry: true, outcomeUnknown: true });
    expect(action(html, "retry")).not.toBe("");
    expect(action(html, "confirm")).toBe("");
    expect(action(html, "back")).toContain('disabled=""');
    expect(html).toContain("The order may already exist");
  });
  it("announces a pending order and prevents repeated confirmation", () => {
    const button = action(view({ phase: "confirming", locked: true, consent: true }), "confirm");
    expect(button).toContain('aria-busy="true"');
    expect(button).toContain('disabled=""');
  });
  it("shows actionable errors without claiming autosave or a successful payment", () => {
    const html = view({ phase: "failed", failureCode: "CONSENT_REQUIRED" });
    expect(html).toContain('data-role="status-error"');
    expect(html).toContain("accept the subscription terms");
    expect(html).not.toContain("CONSENT_REQUIRED");
    expect(html).not.toContain("Payment completed");
  });
  it("keeps field labels and country-code serialization in the reused live controls", () => {
    expect(preparation().match(/<label[^>]*for="[^"]+"/g)?.length).toBeGreaterThanOrEqual(5);
    const country = renderToStaticMarkup(createElement(CountryCombobox, { id: "country", value: "OM", ar: false, disabled: false, onChange: vi.fn() }));
    expect(country).toContain('role="combobox"');
    expect(country).toMatch(/type="hidden" name="country" value="OM"/);
    expect(country).toContain(countryLabel("OM", false));
  });
  it("keeps three descriptive review steps noninteractive and motion static during SSR", () => {
    const html = view();
    const list = html.slice(html.indexOf("<ol"), html.indexOf("</ol>"));
    expect(list.match(/<li\b/g)).toHaveLength(3);
    expect(list).toContain('aria-current="step"');
    expect(list).not.toMatch(/<(?:a|button)\b/);
    expect(html).not.toContain("<video");
  });
});
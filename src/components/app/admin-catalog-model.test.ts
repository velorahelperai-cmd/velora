import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminCatalog } from "./admin-catalog";

const state = vi.hoisted(() => ({ locale: "en" as "ar" | "en" }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => state }));
vi.mock("@/lib/billing/catalog-backend/actions", () => ({
  readCatalogAdminAction: vi.fn(), saveCatalogDraftAction: vi.fn(), publishCatalogVersionAction: vi.fn(),
}));

function renderCatalog(locale: "ar" | "en") {
  state.locale = locale;
  return renderToStaticMarkup(createElement(AdminCatalog, { initial: { ok: true, data: {
    revision: 1,
    versions: [{
      code: "noor_basic", currency: "OMR", amount_baisa: 45000, period_unit: "month", period_count: 1,
      limits: { automated_outbound_per_month: 734, feature_availability: {} },
      version_id: "synthetic-version", version: 1, status: "published",
    }],
  } } }));
}

describe("admin catalog visible identity and reference", () => {
  it.each([["en", "Noura"], ["ar", "نورا"]] as const)("uses %s display names while preserving catalog codes", (locale, name) => {
    const markup = renderCatalog(locale);
    expect(markup.match(/<option\b[^>]*value="noor_basic"[^>]*>([^<]+)<\/option>/)?.[1]).toBe(`${name} / Basic`);
    expect(markup.match(/<option\b[^>]*value="noor_premium"[^>]*>([^<]+)<\/option>/)?.[1]).toBe(`${name} / Premium`);
    expect(markup).toContain(`<h3>${name} / Basic</h3>`);
    expect(markup).not.toContain("noor / ");
  });

  it.each(["ar", "en"] as const)("does not claim commercial approval in %s from the inherited Test reference", (locale) => {
    const markup = renderCatalog(locale);
    expect(markup).not.toMatch(/approved commercial reference|Approved 45 OMR|المرجع التجاري المعتمد|معتمد 45 ر\.ع/);
  });
});

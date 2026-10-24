import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubscriptionOfferCards } from "./subscription-offer-cards";
import type { SubscriptionPackage, SubscriptionPersona, SubscriptionTerm } from "./subscription-offers-view";
import { commercialPlan, matchingCommercialOffer, matchesCommercialOffer } from "./subscription-commercial-catalog";
import type { SubscriptionOfferView } from "./subscription-offers-view";

const prices = [
  ["level_1", "basic", 45000, 432000, 1000],
  ["level_1", "premium", 90000, 864000, 3000],
  ["level_2", "basic", 65000, 624000, 2000],
  ["level_2", "premium", 120000, 1152000, 6000],
  ["level_3", "basic", 90000, 864000, 3000],
  ["level_3", "premium", 150000, 1440000, 10000],
] as const;

function card(persona: SubscriptionPersona, pack: SubscriptionPackage, term: SubscriptionTerm) {
  const html = renderToStaticMarkup(createElement(SubscriptionOfferCards, {
    locale: "en", term, offers: [], catalogStatus: "empty", selectedPersona: persona,
    selectedPackage: pack, onSelect: () => {},
  }));
  return html.split(`data-persona="${persona}"`)[1].split("</article>")[0];
}

describe("approved six-plan commercial display", () => {
  it.each(prices)("shows %s / %s at the agreed price in both terms without fabricating checkout", (persona, pack, monthly, annual, replies) => {
    const monthlyHtml = card(persona, pack, "monthly"), annualHtml = card(persona, pack, "yearly");
    expect(monthlyHtml).toContain(`${monthly / 1000}.000 OMR`);
    expect(annualHtml).toContain(`${(annual / 1000).toLocaleString("en-US")}.000 OMR`);
    expect(annualHtml).toContain("20%");
    expect(monthlyHtml).toContain(replies.toLocaleString("en-US"));
    expect(annualHtml).toContain(replies.toLocaleString("en-US"));
    expect(monthlyHtml).toContain('data-purchase-state="unavailable"');
    expect(annualHtml).toContain('data-purchase-state="unavailable"');
    expect(annualHtml).not.toContain("Published price");
  });

  it("uses Standard as the customer-facing level name", () => {
    expect(card("level_1", "basic", "monthly")).toContain("Standard");
  });

  it("loads the supplied Noura and Lina clips on demand without autoplay or looping speech", () => {
    const noura = card("level_1", "basic", "monthly"), lina = card("level_2", "basic", "monthly");
    expect(noura).toContain("noura-intro-bcb4f550-portrait.mp4");
    expect(lina).toContain("lina-intro-153ef539-portrait.mp4");
    for (const html of [noura, lina]) {
      expect(html).toContain('preload="none"');
      expect(html).not.toMatch(/<video[^>]*\bautoPlay=/i);
      expect(html).not.toMatch(/<video[^>]*\bloop=/);
    }
  });

  it("requires the exact server price, monthly allowance and billing term before binding a choice", () => {
    const offer: SubscriptionOfferView = { persona: "level_1", package: "basic", term: "monthly", amountBaisa: 45000,
      automatedOutboundPerMonth: 1000, currency: "OMR", versionId: "published-version", planId: "persisted-plan",
      quotaEnforcement: "not_verified", features: [], testCheckoutReady: true };
    expect(matchesCommercialOffer(offer)).toBe(true);
    expect(matchesCommercialOffer({ ...offer, amountBaisa: 1 })).toBe(false);
    expect(matchesCommercialOffer({ ...offer, automatedOutboundPerMonth: 500 })).toBe(false);
    expect(matchesCommercialOffer({ ...offer, term: "yearly" })).toBe(false);
    expect(matchingCommercialOffer(commercialPlan("level_1", "basic"), "monthly", [])).toBeUndefined();
    expect(matchingCommercialOffer(commercialPlan("level_1", "basic"), "monthly", [offer, { ...offer, versionId: "ambiguous" }])).toBeUndefined();
    expect(matchingCommercialOffer(commercialPlan("level_1", "basic"), "yearly", [offer])).toBeUndefined();
  });
});

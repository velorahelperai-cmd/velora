import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubscriptionOfferCards } from "./subscription-offer-cards";
import { offersViewFromCatalog, isPurchasableOffer, type SubscriptionOfferView } from "./subscription-offers-view";
import { choiceFromSubscriptionIntent } from "./subscription-navigation";

const basic: SubscriptionOfferView = { versionId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", planId:"plan", persona:"level_1", package:"basic", term:"monthly", amountBaisa:45000,currency:"OMR",automatedOutboundPerMonth:734,quotaEnforcement:"not_verified",checkoutEnabled:false,features:[{id:"knowledge",label:{ar:"المعرفة",en:"Company knowledge"},availability:"not_verified"}]};
const premium: SubscriptionOfferView = {...basic,versionId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",package:"premium",amountBaisa:87654,automatedOutboundPerMonth:1923};
function render(offer:SubscriptionOfferView,locale:"en"|"ar"="en",status:"ready"|"error"|"empty"="ready") {
 return renderToStaticMarkup(createElement(SubscriptionOfferCards,{locale,term:"monthly",offers:status==="ready"?[offer.package==="basic"?offer:basic,offer.package==="premium"?offer:premium]:[],catalogStatus:status,selectedPersona:"level_1",selectedPackage:offer.package,onSelect:()=>{}}));
}
describe("published catalog separate from purchase and service readiness",()=>{
 it("shows the approved Premium scope without accepting a differently priced billing version",()=>{
  const html=render(premium);const card=html.split('data-persona="level_1"')[1].split("</article>")[0];
  expect(card).toContain("90.000 OMR");expect(card).toContain("3,000");expect(card).not.toContain("87.654 OMR");
  expect(card).not.toContain("Published price");
  expect(card).toContain("Plan selected");expect(card).toContain("Checkout unavailable");
 });
 it("rejects a Test marker on a billing version with a different allowance",()=>{
  const card=render({...basic,testCheckoutReady:true}).split('data-persona="level_1"')[1].split("</article>")[0];
  expect(card).not.toContain("Test checkout only");expect(card).toContain('data-purchase-state="unavailable"');expect(card).toContain("Service readiness not verified");
  expect(card).not.toContain("Approved");expect(card).toContain('data-feature-id="knowledge"');
 });
 it("preserves real catalog errors instead of converting them to an unconfigured catalog",()=>{
  expect(offersViewFromCatalog({ok:false,code:"unavailable"}).status).toBe("error");
 });
 it("keeps commercial prices visible while reporting billing failures",()=>{
  expect(render(basic,"en","empty")).toContain("45.000 OMR");
  expect(render(basic,"en","error")).toContain("The catalog could not be loaded");
 });
 it("keeps Premium and planned personas out of the existing Test purchase contract",()=>{
  expect(isPurchasableOffer("level_1","premium","monthly",premium,"ready")).toBe(false);
  expect(isPurchasableOffer("level_2","basic","monthly",{...basic,persona:"level_2"},"ready")).toBe(false);
 });
 it("retains version-bound Premium browsing and rejects modified prices",()=>{
  const intent={persona:"level_1" as const,package:"premium" as const,term:"monthly" as const,versionId:premium.versionId,amountBaisa:premium.amountBaisa,currency:"OMR" as const};
  expect(choiceFromSubscriptionIntent(intent,{status:"ready",offers:[premium]})?.versionId).toBe(premium.versionId);
  expect(choiceFromSubscriptionIntent({...intent,amountBaisa:1},{status:"ready",offers:[premium]})).toBeNull();
 });
 it("renders equivalent Arabic states without publishing planned services",()=>{
  const html=render(premium,"ar");expect(html).not.toContain("سعر منشور");expect(html).toContain("90.000 ر.ع.");expect(html).toContain("الدفع غير متاح");expect(html).toContain("خدمة مخططة");
 });
});

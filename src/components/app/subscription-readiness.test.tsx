vi.mock("./account-chrome",()=>({useOptionalAccountSession:()=>null}));
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const params=vi.hoisted(()=>({value:"term=monthly"}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams(params.value)}));
vi.mock("@/lib/billing/wiring/test-checkout-actions",()=>({startTestCheckoutAction:vi.fn()}));
vi.mock("@/lib/billing/wiring/live-checkout-actions",()=>({startLiveCheckoutAction:vi.fn()}));
import { SubscriptionOfferCards } from "./subscription-offer-cards";
import { SubscriptionPanel } from "./subscription-panel";
import { isPurchasableOffer, type SubscriptionOfferView } from "./subscription-offers-view";
import { subscriptionCopy } from "./subscription-copy";
const basic:SubscriptionOfferView={versionId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",planId:"22222222-2222-4222-8222-222222222222",persona:"level_1",package:"basic",term:"monthly",amountBaisa:45000,currency:"OMR",automatedOutboundPerMonth:1000,quotaEnforcement:"not_verified",checkoutEnabled:false,features:[]};
function card(offer:SubscriptionOfferView,locale:"en"|"ar"="en"){
 return renderToStaticMarkup(createElement(SubscriptionOfferCards,{locale,term:"monthly",offers:[offer],catalogStatus:"ready",selectedPersona:"level_1",selectedPackage:offer.package,onSelect:()=>{}})).split('data-persona="level_1"')[1].split("</article>")[0];
}
describe("catalog checkout requires observed server readiness",()=>{
 it("qualified Live Premium displays its payment mode and requires revision",()=>{
  const live={...basic,package:"premium" as const,amountBaisa:90000,automatedOutboundPerMonth:3000,liveCheckoutReady:true,catalogRevision:7};
  expect(isPurchasableOffer("level_1","premium","monthly",live,"ready")).toBe(true);
  expect(card(live)).toContain('data-purchase-state="live"');expect(card(live)).toContain("Continue to Paymob");expect(card(live)).not.toContain("Test checkout only");
  expect(isPurchasableOffer("level_1","premium","monthly",{...live,catalogRevision:undefined},"ready")).toBe(false);
 });
 it("published unbound Basic stays display-only",()=>{
  expect(isPurchasableOffer("level_1","basic","monthly",basic,"ready")).toBe(false);
  expect(card(basic)).toContain('data-purchase-state="unavailable"');
  expect(card(basic)).not.toContain("Test checkout only");
  expect(card(basic)).not.toContain("This version is available for Test checkout");
 });
 it("published Premium remains display-only even if supplied a Test-ready marker",()=>{
  const premium={...basic,package:"premium" as const,amountBaisa:90000,testCheckoutReady:true};
  expect(isPurchasableOffer("level_1","premium","monthly",premium,"ready")).toBe(false);
  expect(card(premium)).toContain('data-purchase-state="unavailable"');
 });
 it("qualified Test readiness permits only the inherited Test edition",()=>{
  const ready={...basic,testCheckoutReady:true};
  expect(isPurchasableOffer("level_1","basic","monthly",ready,"ready")).toBe(true);
  expect(card(ready)).toContain('data-purchase-state="test_only"');
  expect(ready.checkoutEnabled).toBe(false);
 });
 it("missing selection never advertises Paymob Test in the summary",()=>{
  const html=renderToStaticMarkup(createElement(SubscriptionPanel,{locale:"en",companyId:"company",view:{state:"empty",currentTier:null,cycle:null,paidThrough:null},offersView:{status:"ready",offers:[basic]}}));
  const note=html.split('id="subscription-payment-note"')[1].split("</p>")[0];
  expect(note).not.toContain("Paymob Test");
 });
 it("selected unbound Basic summary stays display-only",()=>{
  params.value="term=monthly&persona=level_1&package=basic&version="+basic.versionId+"&amount=45000&currency=OMR";
  const html=renderToStaticMarkup(createElement(SubscriptionPanel,{locale:"en",companyId:"company",view:{state:"empty",currentTier:null,cycle:null,paidThrough:null},offersView:{status:"ready",offers:[basic]}}));
  params.value="term=monthly";
  const note=html.split('id="subscription-payment-note"')[1].split("</p>")[0];
  expect(note).toContain("Checkout is unavailable");expect(note).not.toContain("Test");
 });
 it("unverified Noura copy does not promise always-on operation in either language",()=>{
  expect(subscriptionCopy.en.personas.level_1.fits).not.toContain("always-on");
  expect(subscriptionCopy.ar.personas.level_1.fits).not.toContain("دون انقطاع");
  expect(card(basic)).toContain("Prelaunch");
 });
});

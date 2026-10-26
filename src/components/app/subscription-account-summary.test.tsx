// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { choiceFromOffer, type SubscriptionOfferView } from "./subscription-offers-view";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SubscriptionAccountSummary } from "./subscription-account-summary";
import type { SubscriptionView } from "./subscription-model";
vi.mock("next/image",()=>({default:({src,alt}: {src:string;alt:string})=>createElement("img", {src,alt})}));
const base:SubscriptionView={state:"active",currentTier:"level_1",currentPackage:"basic",cycle:"monthly",paidThrough:null};
describe("subscription summary truthfulness",()=>{
 it.each([["level_1","noura-poster"],["level_2","lina-poster"],["level_3","dana-poster"]] as const)("uses the %s plan character",(currentTier,asset)=>{
  const html=renderToStaticMarkup(<SubscriptionAccountSummary view={{...base,currentTier}} locale="ar" onSelect={()=>{}}/>);
  expect(html).toContain(asset);expect(html).toContain('disabled=""');expect(html).toContain("التجديد المبكر غير متاح");
 });
 it("does not invent a plan, price or character for an unconfigured account",()=>{
  const html=renderToStaticMarkup(<SubscriptionAccountSummary view={{...base,state:"unconfigured",currentTier:null,currentPackage:null}} locale="ar" onSelect={()=>{}}/>);
  expect(html).not.toContain("/media/packages/");expect(html).not.toContain("45.000");expect(html).toContain('disabled=""');
 });
 it("does not format an invalid provider date as a real date",()=>{
  expect(()=>renderToStaticMarkup(<SubscriptionAccountSummary view={{...base,paidThrough:"invalid"}} locale="en" onSelect={()=>{}}/>)).not.toThrow();
 });
});

const payable: SubscriptionOfferView = {versionId:"renewal-version",planId:"plan",persona:"level_1",package:"basic",term:"monthly",amountBaisa:45000,currency:"OMR",automatedOutboundPerMonth:1000,quotaEnforcement:"not_verified",checkoutEnabled:false,testCheckoutReady:true,features:[]};
it("renewal selects the qualified offer for review and remains blocked in preview", async () => {
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const host=document.createElement("div"),root=createRoot(host),onSelect=vi.fn();document.body.append(host);
 const props={view:{...base,state:"expired" as const},catalog:{status:"ready" as const,offers:[payable]},locale:"en" as const,onSelect};
 await act(async()=>root.render(<SubscriptionAccountSummary {...props}/>));
 const button=host.querySelector("button")!;expect(button.disabled).toBe(false);
 await act(async()=>button.click());expect(onSelect).toHaveBeenCalledExactlyOnceWith(choiceFromOffer(payable));
 await act(async()=>root.render(<SubscriptionAccountSummary {...props} preview/>));
 expect(host.querySelector("button")!.disabled).toBe(true);
 await act(async()=>root.render(<SubscriptionAccountSummary {...props} catalog={{status:"ready",offers:[payable,{...payable,versionId:"other"}]}}/>));
 expect(host.querySelector("button")!.disabled).toBe(true);
 await act(async()=>root.unmount());host.remove();
});

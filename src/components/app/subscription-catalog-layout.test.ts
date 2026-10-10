import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { SubscriptionOfferCards } from "./subscription-offer-cards";
import styles from "./subscription-panel.module.css";
import type { SubscriptionOfferView } from "./subscription-offers-view";

it("provides actual SSR catalog surfaces for isolated static layout verification",()=>{
 const basic:SubscriptionOfferView={versionId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",planId:"plan",persona:"level_1",package:"basic",term:"monthly",amountBaisa:45000,currency:"OMR",automatedOutboundPerMonth:734,quotaEnforcement:"not_verified",checkoutEnabled:false,features:[]};
 const premium:SubscriptionOfferView={...basic,versionId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",package:"premium",amountBaisa:87654};
 const css=readFileSync(resolve("src/components/app/subscription-panel.module.css"),"utf8").replace(/\.([A-Za-z_][A-Za-z0-9_-]*)/g,(match,name)=>styles[name]?"."+styles[name]:match);
 for(const locale of ["en","ar"] as const) for(const edition of ["basic","premium"] as const){
  const body=renderToStaticMarkup(createElement("main",{className:styles.root,"data-surface":"public",dir:locale==="ar"?"rtl":"ltr",lang:locale},
   createElement(SubscriptionOfferCards,{locale,term:"monthly",offers:[basic,premium],catalogStatus:"ready",selectedPersona:"level_1",selectedPackage:edition,onSelect:()=>{}}),
   createElement("p",{className:styles.selectionTitle},locale==="ar"?"الباقة المحددة":"Selected plan")));
  expect(body).toContain('data-purchase-state=');
  if(process.env.CATALOG_ARTIFACT_DIR){
   mkdirSync(process.env.CATALOG_ARTIFACT_DIR,{recursive:true});
   writeFileSync(resolve(process.env.CATALOG_ARTIFACT_DIR,locale+"-"+edition+".html"),'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}'+css+"</style>"+body);
  }
 }
});

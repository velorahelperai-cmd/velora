"use client";
import { useState } from "react";
import { SubscriptionPanel } from "@/components/app/subscription-panel";
import { subscriptionCopy } from "@/components/app/subscription-copy";
import type { SubscriptionDisplayState, SubscriptionView } from "@/components/app/subscription-model";

const states: SubscriptionDisplayState[] = ["unconfigured", "loading", "error", "empty", "pending", "active", "expired", "suspended"];
/** Synthetic scenarios stay here; the real settings route never imports this file. */
function fixture(state: SubscriptionDisplayState): SubscriptionView {
  return { state, currentTier: ["active", "expired", "suspended", "pending"].includes(state) ? "level_2" : null, cycle: ["active", "expired"].includes(state) ? "monthly" : null, paidThrough: null };
}
export function SubscriptionPreview() {
  const [locale, setLocale] = useState<"ar" | "en">("ar");
  const [scenario, setScenario] = useState<SubscriptionDisplayState>("unconfigured");
  const c = subscriptionCopy[locale];
  return <main lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} style={{ background:"#050b08", minHeight:"100svh", padding:"24px 16px", color:"#d4e8dc" }}>
    <div style={{ maxWidth:1180, margin:"0 auto" }}>
      <header style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"center", marginBottom:20 }}>
        <strong>{c.previewTitle}</strong><span style={{ fontSize:12 }}>{c.preview}</span>
        <label>{c.scenario} <select aria-label={c.scenario} value={scenario} onChange={(e) => setScenario(e.target.value as SubscriptionDisplayState)} style={{ background:"#1c3427", color:"#d4e8dc", padding:10, borderRadius:8 }}>
          {states.map((state) => <option key={state} value={state}>{c.states[state]}</option>)}
        </select></label>
        <button type="button" onClick={() => setLocale(locale === "ar" ? "en" : "ar")} style={{ minHeight:44, padding:"8px 20px", borderRadius:8, background:"#123c2a", color:"white" }}>{locale === "ar" ? "English" : "العربية"}</button>
      </header>
      <SubscriptionPanel key={scenario} locale={locale} view={fixture(scenario)} offersView={{status:"unconfigured", offers:[]}} preview onRetry={() => setScenario("unconfigured")} />
    </div>
  </main>;
}

import type { AIModelId } from "../types";

export const REAL_OUTPUT_LIMIT = 512;
export const REAL_TIMEOUT_MS = 30_000;
export type RealTokenUsage = { promptTokens:number; completionTokens:number; cachedTokens:number; reasoningTokens:number; cacheWriteTokens:number };
export function realModelPricing(model:AIModelId, now=new Date()) {
 const future=now.toISOString().slice(0,10)>="2027-01-01";
 const rates=model==="gpt-6-luna" ? {input:0.1,cached:0.01,write:0.125,output:0.5}
  :model==="gpt-6.1-sol" ? {input:2,cached:0.1,write:2.5,output:10}
  :{input:future?1.5:0.75,cached:future?0.15:0.075,write:future?1.5:0.75,output:future?7.5:3.75};
 return {...rates,usdPerOmr:2.6008,version:future?"verified-2027-01-01":"verified-2026-10-08",source:model==="gemini-3.8-flash"?"https://ai.google.dev/gemini-api/docs/pricing":`https://developers.openai.com/api/docs/models/${model}`};
}
export type RealPricing = ReturnType<typeof realModelPricing>;
export function priceRealUsage(usage:RealTokenUsage, pricing:RealPricing) {
 for(const value of Object.values(usage)) if(!Number.isSafeInteger(value)||value<0) throw Error("INVALID_PROVIDER_USAGE");
 if(usage.cachedTokens+usage.cacheWriteTokens>usage.promptTokens) throw Error("INVALID_PROVIDER_USAGE");
 const usd=((usage.promptTokens-usage.cachedTokens-usage.cacheWriteTokens)*pricing.input+usage.cachedTokens*pricing.cached+usage.cacheWriteTokens*pricing.write+usage.completionTokens*pricing.output)/1_000_000;
 return {costUsd:Math.ceil(usd*1e10)/1e10,costBaisa:Math.ceil(usd*1000/pricing.usdPerOmr*1e6)/1e6};
}
export function reserveRealCost(model:AIModelId, system:string, prompt:string, pricing:RealPricing) {
 const inputUpperBound=new TextEncoder().encode(system+prompt).length+2048;
 // Gemini thought-token limits are not an independent hard ceiling. Reserve the
 // model's entire 64K output window, then release the difference after usage arrives.
 const outputUpperBound=model==="gemini-3.8-flash"?65536:REAL_OUTPUT_LIMIT;
 const usd=(inputUpperBound*Math.max(pricing.input,pricing.write)+outputUpperBound*pricing.output)/1_000_000;
 return Math.ceil(usd*1.2*1000/pricing.usdPerOmr*1e6)/1e6;
}

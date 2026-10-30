import type { AIModelId } from "../types";

export const REAL_OUTPUT_LIMIT = 512;
export const REAL_TIMEOUT_MS = 30_000;
export type RealTokenUsage = { promptTokens:number; completionTokens:number; cachedTokens:number; reasoningTokens:number; cacheWriteTokens:number; totalTokens?:number };
export function realModelPricing(model:AIModelId, now=new Date()) {
 if(!["gpt-6-luna","gpt-6.1-sol","gemini-3.8-flash"].includes(model)) throw Error("INVALID_MODEL");
 const future=now.toISOString().slice(0,10)>="2027-01-01";
 const rates=model==="gpt-6-luna" ? {input:0.1,cached:0.01,write:0.125,output:0.5}
  :model==="gpt-6.1-sol" ? {input:2,cached:0.1,write:2.5,output:10}
  :{input:future?1.5:0.75,cached:future?0.15:0.075,write:future?1.5:0.75,output:future?7.5:3.75};
 return {...rates,modelId:model,usdPerOmr:2.6008,version:future&&model==="gemini-3.8-flash"?"verified-2027-01-01":"verified-2026-10-08",effectiveDate:future&&model==="gemini-3.8-flash"?"2027-01-01":"2026-10-08",longContextThreshold:model==="gemini-3.8-flash"?null:272_000,source:model==="gemini-3.8-flash"?"https://ai.google.dev/gemini-api/docs/pricing":`https://developers.openai.com/api/docs/models/${model}`};
}
export type RealPricing = ReturnType<typeof realModelPricing>;
/** Public Standard text tariff only: no tools, regional endpoints, or paid cache storage. */
export function effectiveRealPricing(pricing:RealPricing, promptTokens:number) {
 for(const value of [pricing.input,pricing.cached,pricing.write,pricing.output,pricing.usdPerOmr]) if(!Number.isFinite(value)||value<=0) throw Error("INVALID_PRICING");
 if(!Number.isSafeInteger(promptTokens)||promptTokens<0) throw Error("INVALID_PROVIDER_USAGE");
 const long=pricing.longContextThreshold!==null&&promptTokens>pricing.longContextThreshold;
 return {...pricing,input:pricing.input*(long?2:1),cached:pricing.cached*(long?2:1),write:pricing.write*(long?2:1),output:pricing.output*(long?1.5:1)};
}
export function priceRealUsage(usage:RealTokenUsage, pricing:RealPricing) {
 for(const value of [usage.promptTokens,usage.completionTokens,usage.cachedTokens,usage.reasoningTokens,usage.cacheWriteTokens]) if(!Number.isSafeInteger(value)||value<0) throw Error("INVALID_PROVIDER_USAGE");
 if(!Number.isSafeInteger(usage.promptTokens+usage.completionTokens)||(usage.totalTokens!==undefined&&usage.totalTokens!==usage.promptTokens+usage.completionTokens)) throw Error("INVALID_PROVIDER_USAGE");
 if(usage.cachedTokens+usage.cacheWriteTokens>usage.promptTokens||usage.reasoningTokens>usage.completionTokens) throw Error("INVALID_PROVIDER_USAGE");
 const rates=effectiveRealPricing(pricing,usage.promptTokens);
 const usd=((usage.promptTokens-usage.cachedTokens-usage.cacheWriteTokens)*rates.input+usage.cachedTokens*rates.cached+usage.cacheWriteTokens*rates.write+usage.completionTokens*rates.output)/1_000_000;
 return {costUsd:Math.ceil(usd*1e10)/1e10,costBaisa:Math.ceil(usd*1000/pricing.usdPerOmr*1e6)/1e6};
}
export function reserveRealCost(model:AIModelId, system:string, prompt:string, pricing:RealPricing, requestedMaxOutputTokens?:number, providerInputTokens?:number) {
 if(pricing.modelId!==model) throw Error("INVALID_PRICING");
 const bytes = new TextEncoder().encode(system + prompt).length;
 // Provider-counted input is authoritative; otherwise a token is never shorter than one UTF-8 byte,
 // so byte length is a proven conservative upper bound (never a weaker estimate).
 const bounded = typeof requestedMaxOutputTokens === "number" && requestedMaxOutputTokens > 0;
 const inputUpperBound = typeof providerInputTokens === "number" && Number.isSafeInteger(providerInputTokens) && providerInputTokens > 0
  ? providerInputTokens : (bounded ? bytes : bytes + 2048);
 const rates = effectiveRealPricing(pricing, inputUpperBound);
 // When an explicit max output limit is configured, reserve for that exact ceiling.
 // Otherwise reserve the model's full default ceiling (e.g. 64K for Gemini 3.8 Flash).
 const outputUpperBound = typeof requestedMaxOutputTokens === "number" && Number.isSafeInteger(requestedMaxOutputTokens) && requestedMaxOutputTokens > 0
  ? requestedMaxOutputTokens
  : (model === "gemini-3.8-flash" ? 65536 : REAL_OUTPUT_LIMIT);
 const usd = (inputUpperBound * Math.max(rates.input, rates.write) + outputUpperBound * rates.output) / 1_000_000;
 return Math.ceil(usd * 1.2 * 1000 / pricing.usdPerOmr * 1e6) / 1e6;
}

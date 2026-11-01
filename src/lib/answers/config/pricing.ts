import { effectiveRealPricing, priceRealUsage, realModelPricing } from "../runtime/economics";
import type { AIModelId, AIProviderName } from "../types";

export type ModelPricingTier = {
  modelId: AIModelId;
  provider: AIProviderName;
  displayName: string;
  effectiveDate: string;
  version: string;
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
  cachedUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  reasoningUsdPerMillion?: number;
  promptBaisaPerMillion: number;
  completionBaisaPerMillion: number;
  cachedBaisaPerMillion: number;
  cacheWriteBaisaPerMillion: number;
  reasoningBaisaPerMillion?: number;
  source: string;
};

// Public Standard text prices verified on this date; account-specific billing is unverified.
export const PRICING_STATUS = "verified_public_standard" as const;
export const PRICING_EFFECTIVE_DATE = "2026-10-08";
export const PRICING_VERSION = "verified-2026-10-08";
/** CBO peg: https://cbo.gov.om/Pages/FixedPeg.aspx — 1 OMR = 2.6008 USD. */
export const USD_TO_BAISA_RATE = 1000 / 2.6008;

function tier(modelId: AIModelId): ModelPricingTier {
  const rates = realModelPricing(modelId, new Date(`${PRICING_EFFECTIVE_DATE}T00:00:00Z`));
  return {
    modelId, provider: modelId.startsWith("gemini-") ? "google" : "openai", displayName: modelId,
    effectiveDate: rates.effectiveDate, version: rates.version, source: rates.source,
    promptUsdPerMillion: rates.input, completionUsdPerMillion: rates.output,
    cachedUsdPerMillion: rates.cached, cacheWriteUsdPerMillion: rates.write,
    reasoningUsdPerMillion: rates.output,
    promptBaisaPerMillion: rates.input * USD_TO_BAISA_RATE,
    completionBaisaPerMillion: rates.output * USD_TO_BAISA_RATE,
    cachedBaisaPerMillion: rates.cached * USD_TO_BAISA_RATE,
    cacheWriteBaisaPerMillion: rates.write * USD_TO_BAISA_RATE,
    reasoningBaisaPerMillion: rates.output * USD_TO_BAISA_RATE,
  };
}

export const MODEL_PRICING_CATALOG: Record<AIModelId, ModelPricingTier> = {
  "gpt-6-luna": tier("gpt-6-luna"),
  "gemini-3.5-flash-lite": tier("gemini-3.5-flash-lite"),
  "gemini-3.8-flash": tier("gemini-3.8-flash"),
  "gpt-6.1-sol": tier("gpt-6.1-sol"),
};

export type TokenBreakdown = {
  promptTokens: number;
  /** Total billed output, including reasoning/thinking. */
  completionTokens: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
};

export type DetailedCostCalculation = {
  costUsd: number;
  costBaisa: number;
  promptCostUsd: number;
  cachedCostUsd: number;
  cacheWriteCostUsd: number;
  completionCostUsd: number;
  reasoningCostUsd: number;
  pricingVersion: string;
  effectiveDate: string;
};

/** Same tariff as real execution: cache and reasoning subsets are charged exactly once. */
export function calculateTokensCostDetailed(modelId: AIModelId, tokens: TokenBreakdown, now = new Date()): DetailedCostCalculation {
  const usage = {
    promptTokens: tokens.promptTokens, completionTokens: tokens.completionTokens,
    cachedTokens: tokens.cachedTokens ?? 0, cacheWriteTokens: tokens.cacheWriteTokens ?? 0,
    reasoningTokens: tokens.reasoningTokens ?? 0,
  };
  const pricing = realModelPricing(modelId, now);
  const cost = priceRealUsage(usage, pricing);
  const rates = effectiveRealPricing(pricing, usage.promptTokens);
  return {
    ...cost,
    promptCostUsd: (usage.promptTokens - usage.cachedTokens - usage.cacheWriteTokens) * rates.input / 1_000_000,
    cachedCostUsd: usage.cachedTokens * rates.cached / 1_000_000,
    cacheWriteCostUsd: usage.cacheWriteTokens * rates.write / 1_000_000,
    completionCostUsd: (usage.completionTokens - usage.reasoningTokens) * rates.output / 1_000_000,
    reasoningCostUsd: usage.reasoningTokens * rates.output / 1_000_000,
    pricingVersion: pricing.version, effectiveDate: pricing.effectiveDate,
  };
}

export function calculateTokensCostBaisa(modelId: AIModelId, tokens: TokenBreakdown): number {
  return calculateTokensCostDetailed(modelId, tokens).costBaisa;
}

import type { AIModelId, AIProviderName } from "@/lib/answers/types";

export type ModelPricingTier = {
  modelId: AIModelId;
  provider: AIProviderName;
  displayName: string;
  effectiveDate: string; // YYYY-MM-DD
  version: string;
  /** USD cost per 1,000,000 prompt tokens */
  promptUsdPerMillion: number;
  /** USD cost per 1,000,000 completion tokens */
  completionUsdPerMillion: number;
  /** USD cost per 1,000,000 cached prompt tokens */
  cachedUsdPerMillion: number;
  /** USD cost per 1,000,000 reasoning tokens (for reasoning models) */
  reasoningUsdPerMillion?: number;
  /** Cost in Baisa per 1,000,000 prompt tokens (1 OMR = 1000 Baisa) */
  promptBaisaPerMillion: number;
  /** Cost in Baisa per 1,000,000 completion tokens */
  completionBaisaPerMillion: number;
  /** Cost in Baisa per 1,000,000 cached prompt tokens */
  cachedBaisaPerMillion: number;
  /** Cost in Baisa per 1,000,000 reasoning tokens (for reasoning models) */
  reasoningBaisaPerMillion?: number;
};

export const PRICING_STATUS = "simulation_unverified" as const;
export const PRICING_EFFECTIVE_DATE = "2026-10-01";
export const PRICING_VERSION = "2026.10.01";

/**
 * Official Central Bank of Oman Peg Rate:
 * 1 OMR = 2.6008 USD  =>  $1 USD = 0.3844970778 OMR = 384.4970778 Baisa.
 */
export const USD_TO_BAISA_RATE = 1000 / 2.6008; // ~ 384.497078

export const MODEL_PRICING_CATALOG: Record<AIModelId, ModelPricingTier> = {
  "gpt-6-luna": {
    modelId: "gpt-6-luna",
    provider: "openai",
    displayName: "GPT-6 Luna (Economical / High-Throughput)",
    effectiveDate: PRICING_EFFECTIVE_DATE,
    version: PRICING_VERSION,
    promptUsdPerMillion: 0.26008, // ~ 100 Baisa / 1M
    completionUsdPerMillion: 1.04032, // ~ 400 Baisa / 1M
    cachedUsdPerMillion: 0.13004, // ~ 50 Baisa / 1M
    promptBaisaPerMillion: 100,
    completionBaisaPerMillion: 400,
    cachedBaisaPerMillion: 50,
  },
  "gemini-3.8-flash": {
    modelId: "gemini-3.8-flash",
    provider: "google",
    displayName: "Gemini 3.8 Flash (Balanced / Context-Rich)",
    effectiveDate: PRICING_EFFECTIVE_DATE,
    version: PRICING_VERSION,
    promptUsdPerMillion: 0.156048, // ~ 60 Baisa / 1M
    completionUsdPerMillion: 0.624192, // ~ 240 Baisa / 1M
    cachedUsdPerMillion: 0.039012, // ~ 15 Baisa / 1M
    promptBaisaPerMillion: 60,
    completionBaisaPerMillion: 240,
    cachedBaisaPerMillion: 15,
  },
  "gpt-6.1-sol": {
    modelId: "gpt-6.1-sol",
    provider: "openai",
    displayName: "GPT-6.1 Sol (High-Reasoning / Risk-Sensitive)",
    effectiveDate: PRICING_EFFECTIVE_DATE,
    version: PRICING_VERSION,
    promptUsdPerMillion: 2.08064, // ~ 800 Baisa / 1M
    completionUsdPerMillion: 8.32256, // ~ 3200 Baisa / 1M
    cachedUsdPerMillion: 1.04032, // ~ 400 Baisa / 1M
    reasoningUsdPerMillion: 8.32256,
    promptBaisaPerMillion: 800,
    completionBaisaPerMillion: 3200,
    cachedBaisaPerMillion: 400,
    reasoningBaisaPerMillion: 3200,
  },
};

export type TokenBreakdown = {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
};

export type DetailedCostCalculation = {
  costUsd: number;
  costBaisa: number;
  promptCostUsd: number;
  cachedCostUsd: number;
  completionCostUsd: number;
  reasoningCostUsd: number;
};

/**
 * Calculates high-precision cost in USD first, then converts to Omani Baisa.
 * Strictly prevents double-counting reasoning tokens.
 * Guaranteed never to truncate micro-requests to zero if tokens were used.
 */
export function calculateTokensCostDetailed(
  modelId: AIModelId,
  tokens: TokenBreakdown,
): DetailedCostCalculation {
  const tier = MODEL_PRICING_CATALOG[modelId];
  if (!tier) {
    return {
      costUsd: 0,
      costBaisa: 0,
      promptCostUsd: 0,
      cachedCostUsd: 0,
      completionCostUsd: 0,
      reasoningCostUsd: 0,
    };
  }

  const prompt = Math.max(0, tokens.promptTokens || 0);
  const completion = Math.max(0, tokens.completionTokens || 0);
  const cached = Math.max(0, tokens.cachedTokens || 0);
  const reasoning = Math.max(0, tokens.reasoningTokens || 0);

  // Uncached prompt portion: cached tokens are billed separately at the discounted rate
  const effectivePrompt = Math.max(0, prompt - cached);
  const promptCostUsd = (effectivePrompt * tier.promptUsdPerMillion) / 1_000_000;
  const cachedCostUsd = (cached * tier.cachedUsdPerMillion) / 1_000_000;

  // In OpenAI reasoning models (and Responses API), completion/output tokens already include reasoning tokens.
  // Avoid double-counting: isolate non-reasoning completion from reasoning subset.
  const isReasoningTier = tier.provider === "openai" && tier.reasoningUsdPerMillion !== undefined;
  const regularCompletion = isReasoningTier
    ? Math.max(0, completion - Math.min(reasoning, completion))
    : completion;

  const completionCostUsd = (regularCompletion * tier.completionUsdPerMillion) / 1_000_000;
  const reasoningCostUsd = isReasoningTier && tier.reasoningUsdPerMillion
    ? (Math.min(reasoning, completion) * tier.reasoningUsdPerMillion) / 1_000_000
    : 0;

  const totalUsd = promptCostUsd + cachedCostUsd + completionCostUsd + reasoningCostUsd;
  const totalBaisa = totalUsd * USD_TO_BAISA_RATE;

  // Preserve micro-precision: do not round to 0 if tokens were consumed
  const finalUsd = totalUsd > 0 ? Math.max(Number(totalUsd.toFixed(8)), 0.00000001) : 0;
  const finalBaisa = totalBaisa > 0 ? Math.max(Number(totalBaisa.toFixed(6)), 0.000001) : 0;

  return {
    costUsd: finalUsd,
    costBaisa: finalBaisa,
    promptCostUsd: Number(promptCostUsd.toFixed(8)),
    cachedCostUsd: Number(cachedCostUsd.toFixed(8)),
    completionCostUsd: Number(completionCostUsd.toFixed(8)),
    reasoningCostUsd: Number(reasoningCostUsd.toFixed(8)),
  };
}

/**
 * Convenience helper returning cost in Baisa for backwards compatibility.
 */
export function calculateTokensCostBaisa(
  modelId: AIModelId,
  tokens: TokenBreakdown,
): number {
  return calculateTokensCostDetailed(modelId, tokens).costBaisa;
}

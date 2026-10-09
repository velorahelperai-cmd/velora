import {
  PRICING_EFFECTIVE_DATE,
  PRICING_VERSION,
  MODEL_PRICING_CATALOG,
  USD_TO_BAISA_RATE,
} from "@/lib/answers/config/pricing";
import type {
  AIModelId,
  AIProviderName,
  AnswerResult,
} from "@/lib/answers/types";
import { matchesRequestedModel } from "../adapters/response-identity";

export interface AIUsageLedgerEntry {
  id: string;
  companyId: string;
  conversationId?: string | null;
  provider: AIProviderName;
  modelId: AIModelId;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheWriteTokens?: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  estimatedCostBaisa: number | null;
  pricingVersion: string;
  effectiveDate: string;
  status: "success" | "failed" | "budget_exceeded" | "rate_limited";
  requestId?: string | null;
  actualModelId?: string | null;
  responseId?: string | null;
  latencyMs?: number;
  attemptsCount: number;
  routingReason?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CompanyAIBudget {
  companyId: string;
  monthlyLimitBaisa: number; // 1 OMR = 1,000 Baisa. Default 40 OMR = 40,000 Baisa
  hardStopEnabled: boolean;
  maxTokensPerRequest: number; // Token safety cap per single query
}

export const DEFAULT_COMPANY_AI_BUDGET: Omit<CompanyAIBudget, "companyId"> = {
  monthlyLimitBaisa: 40_000, // 40 OMR default monthly cap
  hardStopEnabled: true,
  maxTokensPerRequest: 8_000, // runaway safety cap
};

export interface AIUsageLedgerStore {
  record(entry: AIUsageLedgerEntry): Promise<void>;
  getCompanyUsage(
    companyId: string,
    options?: { since?: string; modelId?: AIModelId },
  ): Promise<AIUsageLedgerEntry[]>;
  getCompanySpendBaisa(companyId: string, since?: string): Promise<number>;
  getCompanySpendUsd(companyId: string, since?: string): Promise<number>;
  getBudget(companyId: string): Promise<CompanyAIBudget>;
  setBudget(budget: CompanyAIBudget): Promise<void>;
  reset(): void;
}

/**
 * In-memory store for unit tests, local verification, and offline dry-runs.
 * Guarantees strict company tenancy isolation.
 */
export class InMemoryAIUsageLedger implements AIUsageLedgerStore {
  private entries: AIUsageLedgerEntry[] = [];
  private budgets: Map<string, CompanyAIBudget> = new Map();

  public async record(entry: AIUsageLedgerEntry): Promise<void> {
    this.entries.push(structuredClone(entry));
  }

  public async getCompanyUsage(
    companyId: string,
    options?: { since?: string; modelId?: AIModelId },
  ): Promise<AIUsageLedgerEntry[]> {
    return this.entries.filter((entry) => {
      if (entry.companyId !== companyId) return false;
      if (options?.since && entry.createdAt < options.since) return false;
      if (options?.modelId && entry.modelId !== options.modelId) return false;
      return true;
    }).map((entry) => structuredClone(entry));
  }

  public async getCompanySpendBaisa(companyId: string, since?: string): Promise<number> {
    const list = await this.getCompanyUsage(companyId, { since });
    if (list.some((item) => item.estimatedCostBaisa === null)) throw Error("USAGE_COST_UNKNOWN");
    const total = list.reduce((sum, item) => sum + (item.estimatedCostBaisa ?? 0), 0);
    return Number(total.toFixed(6));
  }

  public async getCompanySpendUsd(companyId: string, since?: string): Promise<number> {
    const list = await this.getCompanyUsage(companyId, { since });
    if (list.some((item) => item.estimatedCostUsd === null)) throw Error("USAGE_COST_UNKNOWN");
    const total = list.reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0);
    return Number(total.toFixed(8));
  }

  public async getBudget(companyId: string): Promise<CompanyAIBudget> {
    const custom = this.budgets.get(companyId);
    if (custom) return { ...custom };
    return {
      companyId,
      ...DEFAULT_COMPANY_AI_BUDGET,
    };
  }

  public async setBudget(budget: CompanyAIBudget): Promise<void> {
    this.budgets.set(budget.companyId, { ...budget });
  }

  public reset(): void {
    this.entries = [];
    this.budgets.clear();
  }
}

// Global active ledger store instance (defaults to in-memory)
let activeLedgerStore: AIUsageLedgerStore = new InMemoryAIUsageLedger();

export function getActiveLedgerStore(): AIUsageLedgerStore {
  return activeLedgerStore;
}

export function setActiveLedgerStore(store: AIUsageLedgerStore): void {
  activeLedgerStore = store;
}

export type BudgetCheckResult =
  | { allowed: true; currentSpendBaisa: number; currentSpendUsd: number; budget: CompanyAIBudget }
  | {
      allowed: false;
      code: "BUDGET_EXCEEDED" | "TOKEN_LIMIT_EXCEEDED" | "BUDGET_UNAVAILABLE";
      currentSpendBaisa: number;
      currentSpendUsd: number;
      budget: CompanyAIBudget;
      message: string;
    };

/**
 * Checks whether the company has sufficient remaining budget and stays within token safety limits.
 * Offline snapshot preflight only. This read does not reserve funds atomically;
 * real execution must use runtime/store's durable reservation before each call.
 */
export async function checkCompanyAIBudget(
  companyId: string,
  estimatedPromptTokens: number = 0,
  optionsOrStore?:
    | {
        projectedCostBaisa?: number;
        store?: AIUsageLedgerStore;
      }
    | AIUsageLedgerStore,
): Promise<BudgetCheckResult> {
  let store: AIUsageLedgerStore;
  let projectedCostBaisa = 0;

  if (optionsOrStore && "getBudget" in optionsOrStore) {
    store = optionsOrStore;
  } else if (optionsOrStore) {
    store = optionsOrStore.store || getActiveLedgerStore();
    projectedCostBaisa = optionsOrStore.projectedCostBaisa ?? 0;
  } else {
    store = getActiveLedgerStore();
  }
  const budget = await store.getBudget(companyId);

  if (!companyId.trim() || budget.companyId !== companyId || !Number.isFinite(projectedCostBaisa) || projectedCostBaisa < 0 ||
      !Number.isSafeInteger(estimatedPromptTokens) || estimatedPromptTokens < 0 ||
      !Number.isFinite(budget.monthlyLimitBaisa) || budget.monthlyLimitBaisa < 0 ||
      !Number.isSafeInteger(budget.maxTokensPerRequest) || budget.maxTokensPerRequest < 0) {
    return { allowed: false, code: "BUDGET_UNAVAILABLE", currentSpendBaisa: 0, currentSpendUsd: 0, budget,
      message: "Invalid tenant budget or projected usage evidence." };
  }

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const entries = await store.getCompanyUsage(companyId, { since: startOfMonth });
  if (entries.some((entry) => entry.metadata?.costStatus === "unknown" || entry.estimatedCostBaisa === null || entry.estimatedCostUsd === null)) {
    return { allowed: false, code: "BUDGET_UNAVAILABLE", currentSpendBaisa: 0, currentSpendUsd: 0, budget,
      message: "Usage cost requires reconciliation before another execution." };
  }

  // 1. Safety check for runaway prompt tokens per single request
  if (estimatedPromptTokens > budget.maxTokensPerRequest) {
    const currentSpendBaisa = await store.getCompanySpendBaisa(companyId);
    const currentSpendUsd = await store.getCompanySpendUsd(companyId);
    return {
      allowed: false,
      code: "TOKEN_LIMIT_EXCEEDED",
      currentSpendBaisa,
      currentSpendUsd,
      budget,
      message: `Prompt tokens (${estimatedPromptTokens}) exceed single-request safety cap (${budget.maxTokensPerRequest}).`,
    };
  }

  // 2. Monthly spend limit check (First day of current month)
  const currentSpendBaisa = await store.getCompanySpendBaisa(companyId, startOfMonth);
  const currentSpendUsd = await store.getCompanySpendUsd(companyId, startOfMonth);
  if (!Number.isFinite(currentSpendBaisa) || currentSpendBaisa < 0 || !Number.isFinite(currentSpendUsd) || currentSpendUsd < 0) {
    return { allowed: false, code: "BUDGET_UNAVAILABLE", currentSpendBaisa, currentSpendUsd, budget,
      message: "Usage cost requires reconciliation before another execution." };
  }
  const projectedSpendBaisa = currentSpendBaisa + projectedCostBaisa;

  if (budget.hardStopEnabled && (currentSpendBaisa >= budget.monthlyLimitBaisa || projectedSpendBaisa > budget.monthlyLimitBaisa)) {
    return {
      allowed: false,
      code: "BUDGET_EXCEEDED",
      currentSpendBaisa,
      currentSpendUsd,
      budget,
      message: `Company monthly AI budget exceeded or projected to exceed (${(currentSpendBaisa / 1000).toFixed(3)} / ${(budget.monthlyLimitBaisa / 1000).toFixed(3)} OMR).`,
    };
  }

  return {
    allowed: true,
    currentSpendBaisa,
    currentSpendUsd,
    budget,
  };
}

/** Records every attempt's evidence in the offline ledger; durable paid execution uses runtime/store. */
export async function recordExecutionInLedger(
  companyId: string,
  result: AnswerResult,
  options?: {
    conversationId?: string | null;
    routingReason?: string;
    attemptsCount?: number;
    modelId?: AIModelId;
    metadata?: Record<string, unknown>;
    store?: AIUsageLedgerStore;
  },
): Promise<AIUsageLedgerEntry> {
  const store = options?.store || getActiveLedgerStore();
  if (!companyId.trim()) throw Error("INVALID_LEDGER_EVIDENCE");
  const recordId = crypto.randomUUID();
  const fallbackModel = result.usage?.modelId ?? result.modelId ?? options?.modelId;
  const attempts = result.attempts?.length ? result.attempts : [{
    modelId: fallbackModel,
    provider: result.usage?.provider ?? (!result.ok ? result.provider : undefined),
    status: result.ok ? "success" : result.providerAttempted === false ? "not_dispatched" : result.retrySafe === true ? "failed" : "uncertain",
    usage: result.usage,
    requestId: result.usage?.requestId ?? (!result.ok ? result.requestId : undefined),
    latencyMs: result.usage?.latencyMs ?? (!result.ok ? result.latencyMs : undefined) ?? 0,
  }];
  const entries = attempts.map((attempt, index): AIUsageLedgerEntry => {
    const modelId = attempt.modelId;
    if (!modelId) throw Error("MISSING_MODEL_EVIDENCE");
    const tier = MODEL_PRICING_CATALOG[modelId];
    if (!tier) throw Error("INVALID_LEDGER_EVIDENCE");
    const usage = attempt.usage;
    if ((attempt.provider && attempt.provider !== tier.provider) ||
        (usage?.provider && usage.provider !== tier.provider) ||
        (usage?.modelId && usage.modelId !== modelId)) throw Error("INVALID_LEDGER_EVIDENCE");
    const promptTokens = usage?.promptTokens ?? 0;
    const completionTokens = usage?.completionTokens ?? 0;
    const cachedTokens = usage?.cachedTokens ?? 0;
    const cacheWriteTokens = usage?.cacheWriteTokens ?? 0;
    const reasoningTokens = usage?.reasoningTokens ?? 0;
    const totalTokens = usage?.totalTokens ?? promptTokens + completionTokens;
    const latencyMs = attempt.latencyMs;
    for (const value of [promptTokens, completionTokens, cachedTokens, cacheWriteTokens, reasoningTokens, totalTokens, latencyMs]) {
      if (!Number.isSafeInteger(value) || value < 0) throw Error("INVALID_LEDGER_EVIDENCE");
    }
    if (totalTokens !== promptTokens + completionTokens || cachedTokens + cacheWriteTokens > promptTokens || reasoningTokens > completionTokens) {
      throw Error("INVALID_LEDGER_EVIDENCE");
    }
    const modelMatches = matchesRequestedModel(usage?.actualModelId, modelId);
    const estimatedCostBaisa = modelMatches ? usage?.estimatedCostBaisa ?? ((usage?.estimatedCostUsd ?? 0) * USD_TO_BAISA_RATE) : 0;
    const estimatedCostUsd = modelMatches ? usage?.estimatedCostUsd ?? (estimatedCostBaisa / USD_TO_BAISA_RATE) : 0;
    if (![estimatedCostBaisa, estimatedCostUsd].every((value) => Number.isFinite(value) && value >= 0)) throw Error("INVALID_LEDGER_EVIDENCE");
    const knownCost = modelMatches && (usage?.estimatedCostBaisa !== undefined || usage?.estimatedCostUsd !== undefined ||
      attempt.status === "not_dispatched" || (attempt.status === "failed" && !usage));
    return {
      id: `${recordId}-${index + 1}`, companyId, conversationId: options?.conversationId ?? null,
      provider: tier.provider, modelId, promptTokens, completionTokens, cachedTokens, cacheWriteTokens, reasoningTokens, totalTokens,
      estimatedCostUsd: knownCost ? Number(estimatedCostUsd.toFixed(10)) : null,
      estimatedCostBaisa: knownCost ? Number(estimatedCostBaisa.toFixed(6)) : null,
      pricingVersion: modelMatches ? usage?.pricingVersion ?? PRICING_VERSION : "unverified_actual_model", effectiveDate: usage?.pricingEffectiveDate ?? PRICING_EFFECTIVE_DATE,
      status: modelMatches && attempt.status === "success" ? "success" : "failed", requestId: usage?.requestId ?? attempt.requestId ?? null,
      actualModelId: usage?.actualModelId ?? null, responseId: usage?.responseId ?? null, latencyMs,
      attemptsCount: options?.attemptsCount ?? (result.ok ? result.attemptsCount : undefined) ?? attempts.length,
      routingReason: options?.routingReason ?? (result.ok ? result.routingReason : null) ?? null,
      errorMessage: attempt.status === "success" ? null : redactLedgerText(!result.ok ? result.message ?? result.code : "Attempt failed"),
      metadata: { ...sanitizeMetadata(options?.metadata ?? {}), executionRecordId: recordId, attemptIndex: index + 1,
        attemptStatus: attempt.status, costStatus: knownCost ? "estimated" : "unknown" },
      createdAt: new Date().toISOString(),
    };
  });
  // Offline stores have no transactional batch contract; any failed write is propagated.
  for (const entry of entries) await store.record(entry);
  return entries[entries.length - 1];
}

function redactLedgerText(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]+/g, "[REDACTED]").slice(0, 300);
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(metadata, (key, value: unknown) =>
    /^(?:api_?key|authorization|access_?token|secret|password)$/i.test(key) ? "[REDACTED]" :
      typeof value === "string" ? redactLedgerText(value) : value)) as Record<string, unknown>;
}

import {
  PRICING_EFFECTIVE_DATE,
  PRICING_VERSION,
  USD_TO_BAISA_RATE,
} from "@/lib/answers/config/pricing";
import type {
  AIModelId,
  AIProviderName,
  AnswerResult,
} from "@/lib/answers/types";

export interface AIUsageLedgerEntry {
  id: string;
  companyId: string;
  conversationId?: string | null;
  provider: AIProviderName;
  modelId: AIModelId;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimatedCostBaisa: number;
  pricingVersion: string;
  effectiveDate: string;
  status: "success" | "failed" | "budget_exceeded" | "rate_limited";
  requestId?: string | null;
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
    this.entries.push({ ...entry });
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
    });
  }

  public async getCompanySpendBaisa(companyId: string, since?: string): Promise<number> {
    const list = await this.getCompanyUsage(companyId, { since });
    const total = list.reduce((sum, item) => sum + (item.estimatedCostBaisa || 0), 0);
    return Number(total.toFixed(6));
  }

  public async getCompanySpendUsd(companyId: string, since?: string): Promise<number> {
    const list = await this.getCompanyUsage(companyId, { since });
    const total = list.reduce((sum, item) => sum + (item.estimatedCostUsd || 0), 0);
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
      code: "BUDGET_EXCEEDED" | "TOKEN_LIMIT_EXCEEDED";
      currentSpendBaisa: number;
      currentSpendUsd: number;
      budget: CompanyAIBudget;
      message: string;
    };

/**
 * Checks whether the company has sufficient remaining budget and stays within token safety limits.
 * Protects against concurrent spikes and retry/fallback overruns.
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
    projectedCostBaisa = optionsOrStore.projectedCostBaisa || 0;
  } else {
    store = getActiveLedgerStore();
  }
  const budget = await store.getBudget(companyId);

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
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const currentSpendBaisa = await store.getCompanySpendBaisa(companyId, startOfMonth);
  const currentSpendUsd = await store.getCompanySpendUsd(companyId, startOfMonth);
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

/**
 * Records an AI execution in the ledger with complete token and cost telemetry.
 */
export async function recordExecutionInLedger(
  companyId: string,
  result: AnswerResult,
  options?: {
    conversationId?: string | null;
    routingReason?: string;
    attemptsCount?: number;
    metadata?: Record<string, unknown>;
    store?: AIUsageLedgerStore;
  },
): Promise<AIUsageLedgerEntry> {
  const store = options?.store || getActiveLedgerStore();
  const id = `ledger-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  if (result.ok) {
    const usage = result.usage;
    const estimatedCostBaisa = usage.estimatedCostBaisa || 0;
    const estimatedCostUsd = usage.estimatedCostUsd || (estimatedCostBaisa > 0 ? estimatedCostBaisa / USD_TO_BAISA_RATE : 0);

    const entry: AIUsageLedgerEntry = {
      id,
      companyId,
      conversationId: options?.conversationId || null,
      provider: usage.provider || "openai",
      modelId: usage.modelId || "gpt-6-luna",
      promptTokens: usage.promptTokens || 0,
      completionTokens: usage.completionTokens || 0,
      cachedTokens: usage.cachedTokens || 0,
      reasoningTokens: usage.reasoningTokens || 0,
      totalTokens: usage.totalTokens || (usage.promptTokens || 0) + (usage.completionTokens || 0),
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
      estimatedCostBaisa: Number(estimatedCostBaisa.toFixed(6)),
      pricingVersion: PRICING_VERSION,
      effectiveDate: PRICING_EFFECTIVE_DATE,
      status: "success",
      requestId: usage.requestId || null,
      attemptsCount: options?.attemptsCount || result.attemptsCount || 1,
      routingReason: options?.routingReason || result.routingReason || null,
      metadata: options?.metadata || {},
      createdAt: new Date().toISOString(),
    };

    await store.record(entry);
    return entry;
  }

  const failedEntry: AIUsageLedgerEntry = {
    id,
    companyId,
    conversationId: options?.conversationId || null,
    provider: "openai",
    modelId: "gpt-6-luna",
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    estimatedCostBaisa: 0,
    pricingVersion: PRICING_VERSION,
    effectiveDate: PRICING_EFFECTIVE_DATE,
    status: result.code === "FORBIDDEN" ? "budget_exceeded" : "failed",
    requestId: null,
    attemptsCount: options?.attemptsCount || 1,
    routingReason: options?.routingReason || null,
    errorMessage: result.message || result.code,
    metadata: options?.metadata || {},
    createdAt: new Date().toISOString(),
  };

  await store.record(failedEntry);
  return failedEntry;
}

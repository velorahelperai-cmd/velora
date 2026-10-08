import type {
  AIModelId,
  AnswerProvider,
  AnswerProviderRequest,
  AnswerResult,
} from "@/lib/answers/types";
import { OpenAIAnswerAdapter } from "@/lib/answers/adapters/openai";
import { GeminiAnswerAdapter } from "@/lib/answers/adapters/gemini";

export type TaskClassification = "risk_escalation" | "catalog_and_products" | "simple_faq";

export interface ClassificationResult {
  modelId: AIModelId;
  taskType: TaskClassification;
  reason: string;
}

export interface RouterConfig {
  /** Keywords indicating high-risk, complaints, legal, or negotiation */
  riskKeywords: string[];
  /** Keywords indicating catalog lookup, comparisons, or multi-item inquiries */
  catalogKeywords: string[];
  /** If total context characters exceeds this, prefer Gemini Flash */
  contextCharsThresholdForGemini: number;
  /** If number of chunks exceeds this, prefer Gemini Flash */
  chunkCountThresholdForGemini: number;
  /** Fallback chain per model */
  fallbackOrder: Record<AIModelId, AIModelId[]>;
  /** Whether to attempt fallback if primary model fails */
  enableFallbackRetry: boolean;
  /** Max total attempts */
  maxAttempts: number;
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  riskKeywords: [
    "شكوى",
    "استرجاع",
    "غش",
    "نصب",
    "احتيال",
    "سرقة",
    "محامي",
    "قضية",
    "تعويض",
    "شرطة",
    "حماية المستهلك",
    "سيء جدا",
    "غير راضي",
    "ارفع شكوى",
    "اريد المدير",
    "المدير المسؤول",
    "تالف",
    "خربان",
    "متضرر",
    "خصم خاص",
    "تفاوض",
    "استثناء",
    "complaint",
    "refund",
    "fraud",
    "scam",
    "lawyer",
    "compensation",
    "police",
    "consumer protection",
    "unacceptable",
    "manager",
    "damaged",
    "negotiate",
  ],
  catalogKeywords: [
    "كتالوج",
    "منيو",
    "قائمة",
    "منتجات",
    "اسعار المنتجات",
    "مواصفات",
    "مقارنة",
    "خيارات",
    "مقاسات",
    "الوان",
    "متوفر",
    "مخزون",
    "فروع",
    "عروض",
    "catalog",
    "menu",
    "products",
    "specifications",
    "compare",
    "inventory",
    "available colors",
    "branches",
    "offers",
  ],
  contextCharsThresholdForGemini: 1500,
  chunkCountThresholdForGemini: 3,
  fallbackOrder: {
    "gpt-6-luna": ["gemini-3.8-flash", "gpt-6.1-sol"],
    "gemini-3.8-flash": ["gpt-6-luna", "gpt-6.1-sol"],
    "gpt-6.1-sol": ["gemini-3.8-flash", "gpt-6-luna"],
  },
  enableFallbackRetry: true,
  maxAttempts: 2,
};

export interface MultiModelRouterOptions {
  config?: Partial<RouterConfig>;
  openAIAdapter?: OpenAIAnswerAdapter;
  geminiAdapter?: GeminiAnswerAdapter;
}

export class MultiModelAIRouter implements AnswerProvider {
  public readonly id = "multi-model-router";
  private config: RouterConfig;
  private openAIAdapter: OpenAIAnswerAdapter;
  private geminiAdapter: GeminiAnswerAdapter;

  constructor(options: MultiModelRouterOptions = {}) {
    this.config = {
      ...DEFAULT_ROUTER_CONFIG,
      ...(options.config || {}),
      fallbackOrder: {
        ...DEFAULT_ROUTER_CONFIG.fallbackOrder,
        ...(options.config?.fallbackOrder || {}),
      },
    };

    this.openAIAdapter = options.openAIAdapter || new OpenAIAnswerAdapter();
    this.geminiAdapter = options.geminiAdapter || new GeminiAnswerAdapter();
  }

  /**
   * Classifies task and risk dynamically based on question intent, context volume, and sensitive keywords.
   */
  public classify(request: AnswerProviderRequest): ClassificationResult {
    // 1. Explicit admin/caller override
    if (request.forceModelId) {
      return {
        modelId: request.forceModelId,
        taskType:
          request.forceModelId === "gpt-6.1-sol"
            ? "risk_escalation"
            : request.forceModelId === "gemini-3.8-flash"
              ? "catalog_and_products"
              : "simple_faq",
        reason: `Explicit model override: ${request.forceModelId}`,
      };
    }

    const questionLower = (request.question || "").toLowerCase();
    const contextChars = request.chunks.reduce((sum, c) => sum + c.text.length, 0);
    const chunkCount = request.chunks.length;

    // 2. Risk & Escalation Check -> Route to Sol
    const matchedRisk = this.config.riskKeywords.find((kw) =>
      questionLower.includes(kw.toLowerCase()),
    );
    if (matchedRisk) {
      return {
        modelId: "gpt-6.1-sol",
        taskType: "risk_escalation",
        reason: `Risk keyword detected: "${matchedRisk}". Routed to high-reasoning Sol for sensitive customer handling.`,
      };
    }

    // 3. Catalog / Broad Multi-context Check -> Route to Gemini Flash
    const matchedCatalog = this.config.catalogKeywords.find((kw) =>
      questionLower.includes(kw.toLowerCase()),
    );
    const isLargeContext =
      contextChars >= this.config.contextCharsThresholdForGemini ||
      chunkCount >= this.config.chunkCountThresholdForGemini;

    if (matchedCatalog || isLargeContext) {
      const reasonDetail = matchedCatalog
        ? `Catalog keyword matched: "${matchedCatalog}"`
        : `Large context volume (${contextChars} chars across ${chunkCount} chunks)`;
      return {
        modelId: "gemini-3.8-flash",
        taskType: "catalog_and_products",
        reason: `${reasonDetail}. Routed to Gemini 3.8 Flash for multi-context efficiency.`,
      };
    }

    // 4. Standard FAQ & High Throughput -> Route to Luna
    return {
      modelId: "gpt-6-luna",
      taskType: "simple_faq",
      reason: "Standard inquiry / FAQ. Routed to economical high-throughput GPT-6 Luna.",
    };
  }

  private getAdapterForModel(modelId: AIModelId): AnswerProvider {
    if (modelId === "gemini-3.8-flash") {
      return this.geminiAdapter;
    }
    return this.openAIAdapter;
  }

  /**
   * Main completion entry point implementing unified AnswerProvider interface.
   * Handles dynamic routing, model dispatch, and fallback retries.
   */
  public async complete(input: AnswerProviderRequest): Promise<AnswerResult> {
    const classification = this.classify(input);
    const initialModel = classification.modelId;

    const plannedModels: AIModelId[] = [initialModel];
    if (this.config.enableFallbackRetry) {
      const fallbacks = this.config.fallbackOrder[initialModel] || [];
      for (const fb of fallbacks) {
        if (!plannedModels.includes(fb) && plannedModels.length < this.config.maxAttempts) {
          plannedModels.push(fb);
        }
      }
    }

    let lastFailure: AnswerResult | null = null;
    let attemptsCount = 0;

    for (const currentModel of plannedModels) {
      attemptsCount++;

      // Guard tenant budget before executing subsequent fallback retries
      if (attemptsCount > 1 && input.companyId) {
        const { checkCompanyAIBudget } = await import("@/lib/answers/ledger/ledger");
        const budgetCheck = await checkCompanyAIBudget(input.companyId, 0);
        if (!budgetCheck.allowed) {
          return {
            ok: false,
            code: "FORBIDDEN",
            message: `Fallback to ${currentModel} blocked: ${budgetCheck.message}`,
          };
        }
      }

      const adapter = this.getAdapterForModel(currentModel);

      const result = await adapter.complete({
        ...input,
        forceModelId: currentModel,
      });

      if (result.ok) {
        return {
          ...result,
          modelId: currentModel,
          routingReason:
            attemptsCount === 1
              ? classification.reason
              : `Fallback attempt #${attemptsCount} to ${currentModel} after previous model error. Initial: ${classification.reason}`,
          attemptsCount,
        };
      }

      lastFailure = result;
      // If error is non-retryable (e.g. invalid input or unauthenticated key on both), proceed or break
      if (result.code === "INVALID_INPUT") {
        return result;
      }
    }

    return (
      lastFailure || {
        ok: false,
        code: "UNAVAILABLE",
        message: "All multi-model routing attempts failed",
      }
    );
  }

  public getConfig(): RouterConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<RouterConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
      fallbackOrder: {
        ...this.config.fallbackOrder,
        ...(newConfig.fallbackOrder || {}),
      },
    };
  }
}

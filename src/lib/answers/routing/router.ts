import type {
  AIModelId,
  AnswerProvider,
  AnswerProviderRequest,
  AnswerResult,
  AnswerAttempt,
} from "@/lib/answers/types";
import { OpenAIAnswerAdapter } from "@/lib/answers/adapters/openai";
import { GeminiAnswerAdapter } from "@/lib/answers/adapters/gemini";
import { assertEligibleAnswerChunks } from "@/lib/answers/guards";

export type TaskClassification = "risk_escalation" | "catalog_and_products" | "simple_faq";

export interface ClassificationResult {
  modelId: AIModelId;
  taskType: TaskClassification;
  reason: string;
  /** Requires a trusted business-action verification/human review, independently of model choice. */
  verificationRequired: boolean;
}

// These requests need authoritative business state, not a more capable language model.
// This conservative local guard complements (and cannot replace) the shared action verifier.
const SENSITIVE_KEYWORDS = [
  "استرجاع", "تعويض", "تحويل بنكي", "حوالة", "تأكيد الدفع", "استلام الدفع", "تم الدفع",
  "بيانات البطاقة", "كلمة المرور", "رمز التحقق", "تشخيص", "استشارة قانونية",
  "refund", "compensation", "bank transfer", "payment received", "payment confirmed",
  "credit card", "password", "otp", "diagnosis", "legal advice",
];
const MODEL_COMPLEXITY: Record<AIModelId, number> = {
  "gpt-6-luna": 1, "gemini-3.8-flash": 2, "gpt-6.1-sol": 3,
};

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
    "gemini-3.8-flash": ["gpt-6.1-sol"],
    "gpt-6.1-sol": [],
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
    const questionLower = (request.question || "").toLowerCase();
    const contextChars = request.chunks.reduce((sum, c) => sum + c.text.length, 0);
    const chunkCount = request.chunks.length;
    const verificationRequired = SENSITIVE_KEYWORDS.some((keyword) => questionLower.includes(keyword));
    const resultWithOverride = (result: ClassificationResult): ClassificationResult => request.forceModelId
      ? { ...result, modelId: request.forceModelId, reason: `Explicit model override: ${request.forceModelId}. ${result.reason}` }
      : result;

    // 2. Risk & Escalation Check -> Route to Sol
    const matchedRisk = this.config.riskKeywords.find((kw) =>
      questionLower.includes(kw.toLowerCase()),
    );
    if (matchedRisk || verificationRequired) {
      return resultWithOverride({
        modelId: "gpt-6.1-sol",
        taskType: "risk_escalation",
        reason: matchedRisk
          ? `Risk keyword detected: "${matchedRisk}". Routed to high-reasoning Sol for sensitive customer handling.`
          : "Sensitive request requires independent business verification and human review.",
        verificationRequired,
      });
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
      return resultWithOverride({
        modelId: "gemini-3.8-flash",
        taskType: "catalog_and_products",
        reason: `${reasonDetail}. Routed to Gemini 3.8 Flash for multi-context efficiency.`,
        verificationRequired,
      });
    }

    // 4. Standard FAQ & High Throughput -> Route to Luna
    return resultWithOverride({
      modelId: "gpt-6-luna",
      taskType: "simple_faq",
      reason: "Standard inquiry / FAQ. Routed to economical high-throughput GPT-6 Luna.",
      verificationRequired,
    });
  }

  /** Shared execution plan: explicit model tests stay pinned and fallback never lowers task capability. */
  public getEligibleModels(request: AnswerProviderRequest): AIModelId[] {
    const classification = this.classify(request);
    const initialModel = classification.modelId;
    if (request.forceModelId || !this.config.enableFallbackRetry) return [initialModel];
    const minimum = classification.taskType === "risk_escalation" ? 3 : classification.taskType === "catalog_and_products" ? 2 : 1;
    const planned: AIModelId[] = [initialModel];
    const maxAttempts = Number.isSafeInteger(this.config.maxAttempts) && this.config.maxAttempts > 0
      ? Math.min(this.config.maxAttempts, 3) : 1;
    for (const fallback of this.config.fallbackOrder[initialModel] || []) {
      if (MODEL_COMPLEXITY[fallback] >= minimum && !planned.includes(fallback) && planned.length < maxAttempts) planned.push(fallback);
    }
    return planned;
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
    if (!input.question?.trim() || !Array.isArray(input.chunks) || (input.forceModelId && !Object.hasOwn(MODEL_COMPLEXITY, input.forceModelId))) {
      return { ok: false, code: "INVALID_INPUT", providerAttempted: false, retrySafe: false };
    }
    if (input.signal?.aborted) return { ok: false, code: "UNAVAILABLE", message: "Request was cancelled before dispatch.", providerAttempted: false, retrySafe: false };
    if (!input.chunks.length) return { ok: false, code: "NO_KNOWLEDGE", providerAttempted: false, retrySafe: false };
    if (input.chunks.some((chunk) => !Number.isSafeInteger(chunk?.contentVersion) || chunk.contentVersion < 1)) return { ok: false, code: "INVALID_INPUT", providerAttempted: false, retrySafe: false };
    try { assertEligibleAnswerChunks(input.chunks); }
    catch { return { ok: false, code: "INVALID_INPUT", providerAttempted: false, retrySafe: false }; }
    const classification = this.classify(input);
    if (classification.verificationRequired && !input.dryRun) return {
      ok: false, code: "UNVERIFIED", message: "A trusted business verification or human review is required for this sensitive request.",
      providerAttempted: false, retrySafe: false,
    };
    if (input.companyId && !input.dryRun) return {
      ok: false, code: "NEEDS_SETUP", message: "DURABLE_RUNTIME_REQUIRED", providerAttempted: false, retrySafe: false,
    };
    const plannedModels = this.getEligibleModels(input);

    let lastFailure: AnswerResult | null = null;
    let attemptsCount = 0;
    const attempts: AnswerAttempt[] = [];

    for (const currentModel of plannedModels) {
      if (input.signal?.aborted) return { ok: false, code: "UNAVAILABLE", message: "Request was cancelled before another dispatch.", providerAttempted: false, retrySafe: false, attempts };
      attemptsCount++;

      const adapter = this.getAdapterForModel(currentModel);

      const started = Date.now();
      let result: AnswerResult;
      try { result = await adapter.complete({ ...input, forceModelId: currentModel }); }
      catch { result = { ok: false, code: "UNAVAILABLE", message: "Provider execution failed with an unknown result.", providerAttempted: true, retrySafe: false }; }
      attempts.push({
        modelId: currentModel, provider: currentModel === "gemini-3.8-flash" ? "google" : "openai",
        status: result.ok ? "success" : result.providerAttempted === false ? "not_dispatched" : result.retrySafe === true ? "failed" : "uncertain",
        usage: result.usage, code: result.ok ? undefined : result.code,
        requestId: result.ok ? result.usage.requestId : result.requestId ?? result.usage?.requestId,
        latencyMs: result.usage?.latencyMs ?? (result.ok ? undefined : result.latencyMs) ?? Date.now() - started,
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
          attempts,
        };
      }

      lastFailure = { ...result, modelId: result.modelId ?? currentModel, provider: result.provider ?? (currentModel === "gemini-3.8-flash" ? "google" : "openai"), attempts };
      // Unknown, aborted, empty, billable or denied outcomes cannot authorize another request.
      if (result.retrySafe !== true || typeof result.providerAttempted !== "boolean" || ["INVALID_INPUT", "FORBIDDEN", "UNVERIFIED", "UNAUTHENTICATED"].includes(result.code)) return lastFailure;
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

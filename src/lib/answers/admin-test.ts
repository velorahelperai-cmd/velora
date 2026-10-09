import { MultiModelAIRouter } from "@/lib/answers/routing/router";
import {
  checkCompanyAIBudget,
  recordExecutionInLedger,
  InMemoryAIUsageLedger,
  type AIUsageLedgerEntry,
} from "@/lib/answers/ledger/ledger";
import type {
  AIModelId,
  AnswerContextChunk,
  AnswerResult,
} from "@/lib/answers/types";

export interface AdminAISimulationInput {
  question: string;
  locale?: "ar" | "en";
  companyId?: string;
  conversationId?: string;
  forceModelId?: AIModelId;
  chunks?: AnswerContextChunk[];
  dryRun?: boolean; // Default true to prevent any unexpected spend during testing
}

export interface AdminAISimulationResult {
  ok: boolean;
  usageMode?: "offline_simulation";
  modelId?: AIModelId;
  taskType?: string;
  routingReason?: string;
  text?: string;
  error?: string;
  tokens?: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  };
  economics?: {
    costBaisa: number;
    costOMR: number;
    currentMonthSpendOMR: number;
    monthlyBudgetOMR: number;
  };
  ledgerEntry?: AIUsageLedgerEntry;
}

const DEFAULT_SAMPLE_CHUNKS: AnswerContextChunk[] = [
  {
    sourceId: "src-sim-hours",
    title: "ساعات العمل والتوصيل",
    contentVersion: 1,
    text: "ساعات العمل من السبت إلى الخميس: 10:00 صباحاً حتى 11:00 مساءً. الجمعة: 2:00 ظهراً حتى 11:30 مساءً. التوصيل متوفر لكافة مناطق مسقط.",
  },
  {
    sourceId: "src-sim-returns",
    title: "سياسة الاسترجاع والشكاوى",
    contentVersion: 1,
    text: "في حال وجود أي شكوى أو رغبة بالاسترجاع خلال 48 ساعة من الاستلام، يتم التواصل المباشر مع خدمة العملاء والمدير المناوب للتعويض الفوري أو إرجاع المبلغ.",
  },
  {
    sourceId: "src-sim-catalog",
    title: "قائمة المنتجات والأسعار",
    contentVersion: 1,
    text: "وجبة شاورما دجاج ممتازة بسعر 1.800 ر.ع. وجبة برجر لحم بالجبن بسعر 2.500 ر.ع. المشروبات الغازية والعصائر الطازجة تبدأ من 0.500 ر.ع.",
  },
];

/**
 * Isolated Admin Simulator for verifying multi-model routing, token mechanics, and budgets.
 * Runs in sandbox/dry-run mode by default — NEVER sends messages to live customers or WhatsApp.
 */
export async function simulateAdminAIAnswer(
  input: AdminAISimulationInput,
): Promise<AdminAISimulationResult> {
  if(input.dryRun===false)return {ok:false,error:"LIVE_SIMULATION_DISABLED"};
  const companyId = input.companyId || "sim-company-velora";
  const locale = input.locale || "ar";
  const chunks = input.chunks && input.chunks.length > 0 ? input.chunks : DEFAULT_SAMPLE_CHUNKS;
  const isDryRun = input.dryRun ?? true;
  // Synthetic estimates must never enter the real usage ledger or query a customer's budget.
  const store = new InMemoryAIUsageLedger();

  // 1. Estimate prompt tokens for safety check
  const estimatedPromptTokens = Math.ceil(
    (input.question.length + chunks.reduce((acc, c) => acc + c.text.length, 0)) / 4,
  );

  // 2. Budget and quota validation
  const budgetCheck = await checkCompanyAIBudget(companyId, estimatedPromptTokens, store);
  if (!budgetCheck.allowed) {
    return {
      ok: false,
      usageMode: "offline_simulation",
      error: budgetCheck.message,
      economics: {
        costBaisa: 0,
        costOMR: 0,
        currentMonthSpendOMR: budgetCheck.currentSpendBaisa / 1000,
        monthlyBudgetOMR: budgetCheck.budget.monthlyLimitBaisa / 1000,
      },
    };
  }

  // 3. Dynamic Router & Execution
  const router = new MultiModelAIRouter();
  const classification = router.classify({
    question: input.question,
    locale,
    chunks,
    forceModelId: input.forceModelId,
  });

  const executionResult: AnswerResult = await router.complete({
    question: input.question,
    locale,
    chunks,
    forceModelId: input.forceModelId,
    dryRun: isDryRun,
    companyId,
    conversationId: input.conversationId,
  });

  // 4. Record to ledger
  const ledgerEntry = await recordExecutionInLedger(companyId, executionResult, {
    conversationId: input.conversationId || "sim-admin-conv",
    routingReason: classification.reason,
    modelId: classification.modelId,
    metadata: { usageMode: "offline_simulation" },
    store,
  });

  const currentTotalSpendBaisa = await store.getCompanySpendBaisa(companyId);

  if (executionResult.ok) {
    const usage = executionResult.usage;
    return {
      ok: true,
      usageMode: "offline_simulation",
      modelId: executionResult.modelId || classification.modelId,
      taskType: classification.taskType,
      routingReason: executionResult.routingReason || classification.reason,
      text: executionResult.text,
      tokens: {
        promptTokens: usage.promptTokens || 0,
        completionTokens: usage.completionTokens || 0,
        cachedTokens: usage.cachedTokens || 0,
        reasoningTokens: usage.reasoningTokens || 0,
        totalTokens: usage.totalTokens || 0,
      },
      economics: {
        costBaisa: usage.estimatedCostBaisa || 0,
        costOMR: (usage.estimatedCostBaisa || 0) / 1000,
        currentMonthSpendOMR: currentTotalSpendBaisa / 1000,
        monthlyBudgetOMR: budgetCheck.budget.monthlyLimitBaisa / 1000,
      },
      ledgerEntry,
    };
  }

  return {
    ok: false,
    usageMode: "offline_simulation",
    modelId: classification.modelId,
    taskType: classification.taskType,
    routingReason: classification.reason,
    error: executionResult.message || executionResult.code,
    ledgerEntry,
  };
}


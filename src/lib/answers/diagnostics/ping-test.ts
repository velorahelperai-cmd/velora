import "server-only";
import { runAdminAITrial } from "../runtime/admin-actions";
import type { AIModelId } from "../types";
import type { RealAttempt } from "../runtime/execute";

export const SYNTHETIC_PING_PROMPT = "هذا اختبار اتصال ببيانات مصطنعة فقط. أجيبي باختصار، ولا تؤكدي تنفيذ أي إجراء حقيقي.";
export const ADMIN_PING_OUTPUT_LIMIT = 128;
export const ADMIN_PING_COST_LIMIT_BAISA = 250;
const MODELS: AIModelId[] = ["gpt-6-luna", "gpt-6.1-sol", "gemini-3.8-flash"];

export interface PingTestResult {
  ok: boolean; modelId: AIModelId; latencyMs: number;
  tokens?: { promptTokens: number; completionTokens: number; cachedTokens: number; reasoningTokens: number; totalTokens: number; cacheWriteTokens?: number };
  economics?: { costUsd: number; costBaisa: number };
  requestId?: string; responseId?: string; actualModelId?: string; responseText?: string; error?: string; timestamp: string;
}

/** No side effects: prepare three independent, pinned, synthetic owner trials. */
export function prepareLiveModelPings() {
  return MODELS.map(modelId => ({ modelId, executeConfirmed: false as const, prompt: SYNTHETIC_PING_PROMPT, maxOutputTokens: ADMIN_PING_OUTPUT_LIMIT, maxCostBaisa: ADMIN_PING_COST_LIMIT_BAISA }));
}

function attemptEvidence(attempt: RealAttempt | undefined): Partial<PingTestResult> {
  if (!attempt) return {};
  const usage = attempt.usage;
  return { latencyMs: attempt.latencyMs, requestId: attempt.requestId, responseId: attempt.responseId,
    actualModelId: typeof attempt.actualModelId === "string" ? attempt.actualModelId : undefined,
    tokens: usage ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, cachedTokens: usage.cachedTokens, cacheWriteTokens: usage.cacheWriteTokens, reasoningTokens: usage.reasoningTokens, totalTokens: usage.totalTokens ?? usage.promptTokens + usage.completionTokens } : undefined,
    economics: typeof attempt.costUsd === "number" && typeof attempt.costBaisa === "number" ? { costUsd: attempt.costUsd, costBaisa: attempt.costBaisa } : undefined };
}

/**
 * Later explicit approval only. Reuses owner/session checks, global lifetime 1 OMR
 * reservation and durable attempt settlement; never unlocks customer/WhatsApp AI.
 * Keep the same executionId on retries. No blind provider retries or fallback.
 */
export async function executeLiveModelPing(options: {
  modelId: AIModelId; executeConfirmed: boolean; companyId?: string; executionId?: string; customPrompt?: string;
}): Promise<PingTestResult> {
  const timestamp = new Date().toISOString();
  const failure = (error: string): PingTestResult => ({ ok: false, modelId: options.modelId, latencyMs: 0, error, timestamp });
  if (options.executeConfirmed !== true) return failure("SAFETY_GATE_ACTIVE: Live network execution is blocked until explicitly confirmed by user.");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!MODELS.includes(options.modelId) || !uuid.test(options.companyId ?? "") || !uuid.test(options.executionId ?? "")) return failure("INVALID_TEST_SCOPE");
  if (options.customPrompt !== undefined && options.customPrompt !== SYNTHETIC_PING_PROMPT) return failure("SYNTHETIC_PROMPT_REQUIRED");
  try {
    const result = await runAdminAITrial({ companyId: options.companyId!, executionId: options.executionId!, model: options.modelId, question: SYNTHETIC_PING_PROMPT, locale: "ar", contextMode: "connection", maxOutputTokens: ADMIN_PING_OUTPUT_LIMIT, maxCostBaisa: ADMIN_PING_COST_LIMIT_BAISA });
    if (!result.ok) return { ...failure(result.error), ...attemptEvidence("attempts" in result ? result.attempts.at(-1) : undefined) };
    const attempt = result.attempts.at(-1), usage = attempt?.usage;
    if (!attempt || !usage || attempt.costUsd === null || attempt.costBaisa === null) return failure("PROVIDER_USAGE_UNVERIFIED");
    return { ok: result.complete, modelId: options.modelId, latencyMs: attempt.latencyMs,
      tokens: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, cachedTokens: usage.cachedTokens, cacheWriteTokens: usage.cacheWriteTokens, reasoningTokens: usage.reasoningTokens, totalTokens: usage.totalTokens ?? usage.promptTokens + usage.completionTokens },
      economics: { costUsd: attempt.costUsd, costBaisa: attempt.costBaisa }, requestId: attempt.requestId, responseId: attempt.responseId, actualModelId: attempt.actualModelId, responseText: result.text.slice(0, 150), error: result.complete ? undefined : "INCOMPLETE_RESPONSE", timestamp };
  } catch {
    // A failure may follow provider contact: do not expose bodies/secrets or retry.
    return failure("ADMIN_TRIAL_UNAVAILABLE");
  }
}

import { OpenAIAnswerAdapter } from "@/lib/answers/adapters/openai";
import { GeminiAnswerAdapter } from "@/lib/answers/adapters/gemini";
import type { AIModelId, AnswerResult } from "@/lib/answers/types";

export interface PingTestResult {
  ok: boolean;
  modelId: AIModelId;
  latencyMs: number;
  tokens?: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  };
  economics?: {
    costUsd: number;
    costBaisa: number;
  };
  requestId?: string;
  responseText?: string;
  error?: string;
  timestamp: string;
}

/**
 * Prepares and defines the payload for a limited live connectivity ping test.
 * IMPORTANT: Has a strict safety gate — requires `executeConfirmed: true` to make real network requests.
 * By default, execution is blocked to comply with zero paid-call policy until user explicitly approves.
 */
export async function executeLiveModelPing(options: {
  modelId: AIModelId;
  executeConfirmed: boolean;
  customPrompt?: string;
}): Promise<PingTestResult> {
  const timestamp = new Date().toISOString();

  // Safety Gate: Block execution unless explicitly instructed
  if (!options.executeConfirmed) {
    return {
      ok: false,
      modelId: options.modelId,
      latencyMs: 0,
      error: "SAFETY_GATE_ACTIVE: Live network execution is blocked until explicitly confirmed by user.",
      timestamp,
    };
  }

  const prompt = options.customPrompt || "مرحبا فيلورا (فحص اتصال)";
  const startTime = Date.now();

  try {
    let result: AnswerResult;

    if (options.modelId === "gemini-3.8-flash") {
      const adapter = new GeminiAnswerAdapter();
      result = await adapter.complete({
        question: prompt,
        locale: "ar",
        chunks: [],
        dryRun: false, // Live call
      });
    } else {
      const adapter = new OpenAIAnswerAdapter({ defaultModelId: options.modelId });
      result = await adapter.complete({
        question: prompt,
        locale: "ar",
        chunks: [],
        forceModelId: options.modelId,
        dryRun: false, // Live call
      });
    }

    const latencyMs = Date.now() - startTime;

    if (result.ok) {
      const usage = result.usage;
      return {
        ok: true,
        modelId: options.modelId,
        latencyMs,
        tokens: {
          promptTokens: usage.promptTokens || 0,
          completionTokens: usage.completionTokens || 0,
          cachedTokens: usage.cachedTokens || 0,
          reasoningTokens: usage.reasoningTokens || 0,
          totalTokens: usage.totalTokens || 0,
        },
        economics: {
          costUsd: usage.estimatedCostUsd || 0,
          costBaisa: usage.estimatedCostBaisa || 0,
        },
        requestId: usage.requestId,
        responseText: result.text.slice(0, 150),
        timestamp,
      };
    }

    return {
      ok: false,
      modelId: options.modelId,
      latencyMs,
      error: result.message || result.code,
      timestamp,
    };
  } catch (err: unknown) {
    const errorObj = err as { message?: string };
    return {
      ok: false,
      modelId: options.modelId,
      latencyMs: Date.now() - startTime,
      error: errorObj?.message || "Execution exception occurred",
      timestamp,
    };
  }
}

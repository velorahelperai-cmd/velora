import "server-only";
import OpenAI from "openai";
import { isLiveAnsweringEnabled } from "@/lib/answers/guards";
import { getSecureProviderKey } from "@/lib/answers/config/env";
import { calculateTokensCostDetailed } from "@/lib/answers/config/pricing";
import { buildAnswerSystemPrompt, formatAnswerUserPrompt } from "@/lib/answers/adapters/prompt";
import { providerRequestLimits, validTokenCount } from "./request-limits";
import { matchesRequestedModel } from "./response-identity";
import type {
  AnswerProvider,
  AnswerProviderRequest,
  AnswerResult,
  AIModelId,
} from "@/lib/answers/types";

export interface OpenAIAdapterOptions {
  client?: OpenAI;
  apiKey?: string;
  defaultModelId?: "gpt-6-luna" | "gpt-6.1-sol";
}

export class OpenAIAnswerAdapter implements AnswerProvider {
  public readonly id = "openai-adapter";
  private client: OpenAI | null = null;
  private readonly injectedTestClient: boolean;
  private defaultModelId: "gpt-6-luna" | "gpt-6.1-sol";

  constructor(options: OpenAIAdapterOptions = {}) {
    this.injectedTestClient = Boolean(options.client);
    this.defaultModelId = options.defaultModelId || "gpt-6-luna";

    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = options.apiKey || getSecureProviderKey("openai");
      if (apiKey) {
        this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: 30_000 });
      }
    }
  }

  public getClient(): OpenAI | null {
    return this.client;
  }

  public async complete(input: AnswerProviderRequest): Promise<AnswerResult> {
    if (input.forceModelId && input.forceModelId !== "gpt-6-luna" && input.forceModelId !== "gpt-6.1-sol") {
      return { ok: false, code: "INVALID_INPUT", message: "Requested model is not supported by the OpenAI adapter.", providerAttempted: false, retrySafe: false };
    }
    const modelId: AIModelId =
      input.forceModelId === "gpt-6.1-sol" || input.forceModelId === "gpt-6-luna"
        ? input.forceModelId
        : this.defaultModelId;

    const contextChars = input.chunks.reduce((sum, c) => sum + c.text.length, 0);
    const limits = providerRequestLimits(input);
    if (!limits) return { ok: false, code: "INVALID_INPUT", message: "Invalid provider output or timeout limit.", modelId, provider: "openai", providerAttempted: false, retrySafe: false };
    if (input.signal?.aborted) return { ok: false, code: "UNAVAILABLE", message: "Request was aborted before dispatch.", modelId, provider: "openai", providerAttempted: false, retrySafe: false };

    // Dry-run mode for safe testing without any live API call or token spending
    if (input.dryRun) {
      const simulatedPromptTokens = Math.ceil((input.question.length + contextChars) / 4);
      const simulatedCompletionTokens = 85;
      const simulatedReasoningTokens = modelId === "gpt-6.1-sol" ? 25 : 0;
      const simulatedCost = calculateTokensCostDetailed(modelId, {
        promptTokens: simulatedPromptTokens,
        completionTokens: simulatedCompletionTokens,
        reasoningTokens: simulatedReasoningTokens,
      });

      return {
        ok: true,
        text: `[محاكاة ${modelId}] أهلاً بك في فيلورا! تم فحص استفسارك بنجاح عبر Responses API.`,
        citations: input.chunks.map((c) => ({
          sourceId: c.sourceId,
          title: c.title,
          contentVersion: c.contentVersion,
        })),
        usage: {
          promptChars: input.question.length,
          contextChars,
          sourceCount: input.chunks.length,
          promptTokens: simulatedPromptTokens,
          completionTokens: simulatedCompletionTokens,
          cachedTokens: 0,
          reasoningTokens: simulatedReasoningTokens,
          totalTokens: simulatedPromptTokens + simulatedCompletionTokens,
          modelId,
          provider: "openai",
          estimatedCostBaisa: simulatedCost.costBaisa,
          estimatedCostUsd: simulatedCost.costUsd,
          requestId: `mock-openai-${Date.now()}`,
        },
        modelId,
        attemptsCount: 1,
      };
    }

    if (!isLiveAnsweringEnabled() && !(process.env.NODE_ENV === "test" && this.injectedTestClient)) {
      return {
        ok: false,
        code: "NEEDS_SETUP",
        message: "Live network provider calls are disabled during Phase 1.",
        modelId, provider: "openai", providerAttempted: false, retrySafe: false,
      };
    }

    if (!this.client) {
      return {
        ok: false,
        code: "NEEDS_SETUP",
        message: "OpenAI client is not configured with an API key",
        modelId, provider: "openai", providerAttempted: false, retrySafe: false,
      };
    }

    if (typeof this.client.responses?.create !== "function") {
      return { ok: false, code: "NEEDS_SETUP", message: "OpenAI Responses API is required.", modelId, provider: "openai", providerAttempted: false, retrySafe: false };
    }
    const startedAt = Date.now();
    try {
    const systemPrompt = buildAnswerSystemPrompt(input.locale, input.persona);
      const userContent = formatAnswerUserPrompt(input.question, input.chunks, input.locale);

      const response = await this.client.responses.create({ model: modelId, instructions: systemPrompt, input: userContent, max_output_tokens: limits.maxOutputTokens, store: false }, { signal: input.signal, timeout: limits.timeoutMs, maxRetries: 0 });
      const text = response.output_text?.trim() || "";
      const requestId = response._request_id || response.id;
      const promptTokens = response.usage?.input_tokens;
      const completionTokens = response.usage?.output_tokens;
      const cachedTokens = response.usage?.input_tokens_details?.cached_tokens ?? 0;
      const reasoningTokens = response.usage?.output_tokens_details?.reasoning_tokens ?? 0;
      if (!validTokenCount(promptTokens) || !validTokenCount(completionTokens) || !validTokenCount(cachedTokens) || !validTokenCount(reasoningTokens) || cachedTokens > promptTokens || reasoningTokens > completionTokens) {
        return { ok: false, code: "UNAVAILABLE", message: "OpenAI usage could not be verified.", modelId, provider: "openai", requestId, latencyMs: Date.now() - startedAt, providerAttempted: true, retrySafe: false };
      }
      // OpenAI reasoning is a subset of output_tokens, not an additional charge.
      const totalTokens = promptTokens + completionTokens;

      const detailedCost = calculateTokensCostDetailed(modelId, {
        promptTokens,
        completionTokens,
        cachedTokens,
        reasoningTokens,
      });

      const usage = {
        promptChars: input.question.length, contextChars, sourceCount: input.chunks.length,
        promptTokens, completionTokens, cachedTokens, reasoningTokens, totalTokens,
        modelId, provider: "openai" as const, estimatedCostBaisa: detailedCost.costBaisa,
        estimatedCostUsd: detailedCost.costUsd, requestId, responseId: response.id,
        actualModelId: response.model, latencyMs: Date.now() - startedAt,
        pricingVersion: detailedCost.pricingVersion, pricingEffectiveDate: detailedCost.effectiveDate,
      };
      if (!matchesRequestedModel(response.model, modelId)) {
        const unpricedUsage = { ...usage, estimatedCostUsd: undefined, estimatedCostBaisa: undefined, pricingVersion: undefined, pricingEffectiveDate: undefined };
        return { ok: false, code: "UNAVAILABLE", message: "Unexpected OpenAI model returned; usage requires reconciliation.", modelId, provider: "openai", usage: unpricedUsage, requestId, latencyMs: usage.latencyMs, providerAttempted: true, retrySafe: false };
      }
      if (!text || (response.status && response.status !== "completed")) {
        return { ok: false, code: "UNAVAILABLE", message: "OpenAI returned no complete answer.", modelId, provider: "openai", usage, requestId, latencyMs: usage.latencyMs, providerAttempted: true, retrySafe: false };
      }
      return {
        ok: true,
        text,
        citations: input.chunks.map((c) => ({
          sourceId: c.sourceId,
          title: c.title,
          contentVersion: c.contentVersion,
        })),
        usage,
        modelId,
        attemptsCount: 1,
      };
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string; name?: string };
      const evidence = { modelId, provider: "openai" as const, latencyMs: Date.now() - startedAt, providerAttempted: true, retrySafe: false };
      // Never return arbitrary provider bodies: they may contain credentials in unknown formats.
      if (errorObj?.name === "AbortError" || errorObj?.name === "APIConnectionTimeoutError" || errorObj?.name === "APIUserAbortError") {
        return { ok: false, code: "UNAVAILABLE", message: "Request timed out or was aborted; provider outcome is unknown.", ...evidence };
      }
      if (errorObj?.status === 401) {
        return { ok: false, code: "UNAUTHENTICATED", message: "Invalid OpenAI API Key", ...evidence };
      }
      if (errorObj?.status === 403) {
        return { ok: false, code: "FORBIDDEN", message: "OpenAI rejected model access.", ...evidence, retrySafe: true };
      }
      if (errorObj?.status === 404) {
        return { ok: false, code: "UNAVAILABLE", message: "Requested OpenAI model is unavailable.", ...evidence, retrySafe: true };
      }
      if (errorObj?.status === 429) {
        return { ok: false, code: "UNAVAILABLE", message: "OpenAI rate limit or quota exceeded", ...evidence };
      }

      return {
        ok: false,
        code: "UNAVAILABLE",
        message: "OpenAI request failed; provider outcome could not be verified.",
        ...evidence,
      };
    }
  }
}

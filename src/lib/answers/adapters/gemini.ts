import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
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

export interface GeminiAdapterOptions {
  client?: GoogleGenAI;
  apiKey?: string;
}

export class GeminiAnswerAdapter implements AnswerProvider {
  public readonly id = "gemini-adapter";
  public readonly modelId: AIModelId = "gemini-3.8-flash";
  private client: GoogleGenAI | null = null;
  private readonly injectedTestClient: boolean;

  constructor(options: GeminiAdapterOptions = {}) {
    this.injectedTestClient = Boolean(options.client);
    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = options.apiKey || getSecureProviderKey("google");
      if (apiKey) {
        this.client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 30_000, retryOptions: { attempts: 1 } } });
      }
    }
  }

  public getClient(): GoogleGenAI | null {
    return this.client;
  }

  public async complete(input: AnswerProviderRequest): Promise<AnswerResult> {
    if (input.forceModelId && input.forceModelId !== this.modelId) {
      return { ok: false, code: "INVALID_INPUT", message: "Requested model is not supported by the Gemini adapter.", providerAttempted: false, retrySafe: false };
    }
    const contextChars = input.chunks.reduce((sum, c) => sum + c.text.length, 0);
    const limits = providerRequestLimits(input);
    if (!limits) return { ok: false, code: "INVALID_INPUT", message: "Invalid provider output or timeout limit.", modelId: this.modelId, provider: "google", providerAttempted: false, retrySafe: false };
    if (input.signal?.aborted) return { ok: false, code: "UNAVAILABLE", message: "Request was aborted before dispatch.", modelId: this.modelId, provider: "google", providerAttempted: false, retrySafe: false };

    // Dry-run mode for safe testing without making live API calls or incurring costs
    if (input.dryRun) {
      const simulatedPromptTokens = Math.ceil((input.question.length + contextChars) / 4);
      const simulatedCompletionTokens = 75;
      const simulatedCost = calculateTokensCostDetailed(this.modelId, {
        promptTokens: simulatedPromptTokens,
        completionTokens: simulatedCompletionTokens,
      });

      return {
        ok: true,
        text: `[محاكاة ${this.modelId}] مرحباً بك في فيلورا! تمت مراجعة البيانات وكتالوج المنتجات بدقة.`,
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
          reasoningTokens: 0,
          totalTokens: simulatedPromptTokens + simulatedCompletionTokens,
          modelId: this.modelId,
          provider: "google",
          estimatedCostBaisa: simulatedCost.costBaisa,
          estimatedCostUsd: simulatedCost.costUsd,
          requestId: `mock-gemini-${Date.now()}`,
        },
        modelId: this.modelId,
        attemptsCount: 1,
      };
    }

    if (!isLiveAnsweringEnabled() && !(process.env.NODE_ENV === "test" && this.injectedTestClient)) {
      return {
        ok: false,
        code: "NEEDS_SETUP",
        message: "Live network provider calls are disabled during Phase 1.",
        modelId: this.modelId, provider: "google", providerAttempted: false, retrySafe: false,
      };
    }

    if (!this.client) {
      return {
        ok: false,
        code: "NEEDS_SETUP",
        message: "Gemini client is not configured with an API key",
        modelId: this.modelId, provider: "google", providerAttempted: false, retrySafe: false,
      };
    }

    const startedAt = Date.now();
    try {
      const systemPrompt = buildAnswerSystemPrompt(input.locale);
      const userContent = formatAnswerUserPrompt(input.question, input.chunks, input.locale);

      const response = await this.client.models.generateContent({
        model: this.modelId,
        contents: userContent,
        config: {
          systemInstruction: systemPrompt,
          // Gemini 3.8 supports low/medium/high; sampling overrides are deprecated.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          maxOutputTokens: limits.maxOutputTokens,
          abortSignal: input.signal,
          httpOptions: { timeout: limits.timeoutMs, retryOptions: { attempts: 1 } },
        },
      });

      const text = response.text?.trim() || "";
      const promptTokens = response.usageMetadata?.promptTokenCount;
      const candidateTokens = response.usageMetadata?.candidatesTokenCount;
      const reasoningTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
      const cachedTokens = response.usageMetadata?.cachedContentTokenCount ?? 0;
      const requestId = response.responseId;
      if (!validTokenCount(promptTokens) || !validTokenCount(candidateTokens) || !validTokenCount(reasoningTokens) || !validTokenCount(cachedTokens) || cachedTokens > promptTokens || (response.usageMetadata?.toolUsePromptTokenCount ?? 0) !== 0) {
        return { ok: false, code: "UNAVAILABLE", message: "Gemini usage could not be verified.", modelId: this.modelId, provider: "google", requestId, latencyMs: Date.now() - startedAt, providerAttempted: true, retrySafe: false };
      }
      // Gemini thoughts are separate from candidates; normalize to total billed output.
      const completionTokens = candidateTokens + reasoningTokens;
      const totalTokens = promptTokens + completionTokens;

      const detailedCost = calculateTokensCostDetailed(this.modelId, {
        promptTokens,
        completionTokens,
        cachedTokens,
        reasoningTokens,
      });
      const usage = {
        promptChars: input.question.length, contextChars, sourceCount: input.chunks.length,
        promptTokens, completionTokens, cachedTokens, reasoningTokens, totalTokens,
        modelId: this.modelId, provider: "google" as const,
        estimatedCostBaisa: detailedCost.costBaisa, estimatedCostUsd: detailedCost.costUsd,
        requestId, responseId: response.responseId, actualModelId: response.modelVersion,
        latencyMs: Date.now() - startedAt,
        pricingVersion: detailedCost.pricingVersion, pricingEffectiveDate: detailedCost.effectiveDate,
      };
      if (!matchesRequestedModel(response.modelVersion, this.modelId)) {
        const unpricedUsage = { ...usage, estimatedCostUsd: undefined, estimatedCostBaisa: undefined, pricingVersion: undefined, pricingEffectiveDate: undefined };
        return { ok: false, code: "UNAVAILABLE", message: "Unexpected Gemini model returned; usage requires reconciliation.", modelId: this.modelId, provider: "google", usage: unpricedUsage, requestId, latencyMs: usage.latencyMs, providerAttempted: true, retrySafe: false };
      }
      if (!text || response.candidates?.some(candidate => candidate.finishReason && candidate.finishReason !== "STOP")) {
        return { ok: false, code: "UNAVAILABLE", message: "Gemini returned no complete answer.", modelId: this.modelId, provider: "google", usage, requestId, latencyMs: usage.latencyMs, providerAttempted: true, retrySafe: false };
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
        modelId: this.modelId,
        attemptsCount: 1,
      };
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string; name?: string };
      const evidence = { modelId: this.modelId, provider: "google" as const, latencyMs: Date.now() - startedAt, providerAttempted: true, retrySafe: false };

      if (errorObj?.name === "AbortError") {
        return { ok: false, code: "UNAVAILABLE", message: "Request timed out or was aborted; provider outcome is unknown.", ...evidence };
      }
      if (errorObj?.status === 401) {
        return { ok: false, code: "UNAUTHENTICATED", message: "Invalid Gemini API Key", ...evidence };
      }
      if (errorObj?.status === 403) {
        return { ok: false, code: "FORBIDDEN", message: "Gemini rejected model access.", ...evidence, retrySafe: true };
      }
      if (errorObj?.status === 404) {
        return { ok: false, code: "UNAVAILABLE", message: "Requested Gemini model is unavailable.", ...evidence, retrySafe: true };
      }
      if (errorObj?.status === 429) {
        return { ok: false, code: "UNAVAILABLE", message: "Gemini rate limit or quota exceeded", ...evidence };
      }

      return {
        ok: false,
        code: "UNAVAILABLE",
        message: "Gemini request failed; provider outcome could not be verified.",
        ...evidence,
      };
    }
  }
}

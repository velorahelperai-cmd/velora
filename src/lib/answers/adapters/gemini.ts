import { GoogleGenAI } from "@google/genai";
import { isLiveAnsweringEnabled } from "@/lib/answers/guards";
import { getSecureProviderKey } from "@/lib/answers/config/env";
import { calculateTokensCostDetailed } from "@/lib/answers/config/pricing";
import { buildAnswerSystemPrompt, formatAnswerUserPrompt } from "@/lib/answers/adapters/prompt";
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

function sanitizeErrorMessage(msg: string): string {
  // Redact any accidental Google API key leaks (AIza... or similar patterns)
  return msg.replace(/AIza[a-zA-Z0-9_-]{35}/g, "[REDACTED_API_KEY]")
    .replace(/AQ\.[a-zA-Z0-9_-]{30,}/g, "[REDACTED_API_KEY]");
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
        this.client = new GoogleGenAI({ apiKey });
      }
    }
  }

  public getClient(): GoogleGenAI | null {
    return this.client;
  }

  public async complete(input: AnswerProviderRequest): Promise<AnswerResult> {
    const contextChars = input.chunks.reduce((sum, c) => sum + c.text.length, 0);

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
      };
    }

    if (!this.client) {
      return {
        ok: false,
        code: "NEEDS_SETUP",
        message: "Gemini client is not configured with an API key",
      };
    }

    try {
      const systemPrompt = buildAnswerSystemPrompt(input.locale);
      const userContent = formatAnswerUserPrompt(input.question, input.chunks, input.locale);

      const response = await this.client.models.generateContent({
        model: this.modelId,
        contents: userContent,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.4,
        },
      });

      const text = response.text?.trim() || "";
      if (!text) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "Empty response received from Gemini model",
        };
      }

      const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const completionTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
      const cachedTokens = response.usageMetadata?.cachedContentTokenCount ?? 0;
      const totalTokens =
        response.usageMetadata?.totalTokenCount ?? (promptTokens + completionTokens);

      const detailedCost = calculateTokensCostDetailed(this.modelId, {
        promptTokens,
        completionTokens,
        cachedTokens,
      });

      return {
        ok: true,
        text,
        citations: input.chunks.map((c) => ({
          sourceId: c.sourceId,
          title: c.title,
          contentVersion: c.contentVersion,
        })),
        usage: {
          promptChars: input.question.length,
          contextChars,
          sourceCount: input.chunks.length,
          promptTokens,
          completionTokens,
          cachedTokens,
          reasoningTokens: 0,
          totalTokens,
          modelId: this.modelId,
          provider: "google",
          estimatedCostBaisa: detailedCost.costBaisa,
          estimatedCostUsd: detailedCost.costUsd,
          requestId: `gemini-req-${Date.now()}`,
        },
        modelId: this.modelId,
        attemptsCount: 1,
      };
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string; name?: string };
      const safeMessage = sanitizeErrorMessage(errorObj?.message || "Unknown Gemini execution error");

      if (errorObj?.name === "AbortError") {
        return { ok: false, code: "UNAVAILABLE", message: "Request timed out or was aborted" };
      }
      if (errorObj?.status === 401 || errorObj?.status === 403) {
        return { ok: false, code: "UNAUTHENTICATED", message: "Invalid or unauthorized Gemini API Key" };
      }
      if (errorObj?.status === 404) {
        return { ok: false, code: "UNAVAILABLE", message: `Gemini model unavailable or not found: ${safeMessage}` };
      }
      if (errorObj?.status === 429) {
        return { ok: false, code: "UNAVAILABLE", message: "Gemini rate limit or quota exceeded" };
      }

      return {
        ok: false,
        code: "UNAVAILABLE",
        message: safeMessage,
      };
    }
  }
}

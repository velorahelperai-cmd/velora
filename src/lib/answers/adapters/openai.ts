import OpenAI from "openai";
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

export interface OpenAIAdapterOptions {
  client?: OpenAI;
  apiKey?: string;
  defaultModelId?: "gpt-6-luna" | "gpt-6.1-sol";
}

function sanitizeErrorMessage(msg: string): string {
  // Redact any accidental API key or bearer token leaks
  return msg.replace(/sk-[a-zA-Z0-9_-]{20,}/g, "[REDACTED_API_KEY]");
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
        this.client = new OpenAI({ apiKey });
      }
    }
  }

  public getClient(): OpenAI | null {
    return this.client;
  }

  public async complete(input: AnswerProviderRequest): Promise<AnswerResult> {
    const modelId: AIModelId =
      input.forceModelId === "gpt-6.1-sol" || input.forceModelId === "gpt-6-luna"
        ? input.forceModelId
        : this.defaultModelId;

    const contextChars = input.chunks.reduce((sum, c) => sum + c.text.length, 0);

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
      };
    }

    if (!this.client) {
      return {
        ok: false,
        code: "NEEDS_SETUP",
        message: "OpenAI client is not configured with an API key",
      };
    }

    try {
      const systemPrompt = buildAnswerSystemPrompt(input.locale);
      const userContent = formatAnswerUserPrompt(input.question, input.chunks, input.locale);

      let text = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let cachedTokens = 0;
      let reasoningTokens = 0;
      let totalTokens = 0;
      let requestId = "";

      // Mandatory Responses API primary implementation
      if (typeof this.client.responses?.create === "function") {
        const response = await this.client.responses.create(
          {
            model: modelId,
            instructions: systemPrompt,
            input: userContent,
            temperature: modelId === "gpt-6.1-sol" ? 0.3 : 0.5,
          },
          {
            signal: input.signal,
          },
        );

        text = response.output_text?.trim() || "";
        requestId = response.id;
        promptTokens = response.usage?.input_tokens ?? 0;
        completionTokens = response.usage?.output_tokens ?? 0;
        cachedTokens = response.usage?.input_tokens_details?.cached_tokens ?? 0;
        reasoningTokens = response.usage?.output_tokens_details?.reasoning_tokens ?? 0;
        totalTokens = response.usage?.total_tokens ?? (promptTokens + completionTokens);
      } else {
        // Fallback for chat completions interface
        const completion = await this.client.chat.completions.create(
          {
            model: modelId,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
            temperature: modelId === "gpt-6.1-sol" ? 0.3 : 0.5,
          },
          {
            signal: input.signal,
          },
        );

        text = completion.choices?.[0]?.message?.content?.trim() || "";
        requestId = completion.id;
        promptTokens = completion.usage?.prompt_tokens ?? 0;
        completionTokens = completion.usage?.completion_tokens ?? 0;
        const usageAny = completion.usage as {
          prompt_tokens_details?: { cached_tokens?: number };
          completion_tokens_details?: { reasoning_tokens?: number };
        } | null;

        cachedTokens = usageAny?.prompt_tokens_details?.cached_tokens ?? 0;
        reasoningTokens = usageAny?.completion_tokens_details?.reasoning_tokens ?? 0;
        totalTokens = completion.usage?.total_tokens ?? (promptTokens + completionTokens);
      }

      if (!text) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "Empty response received from OpenAI model",
        };
      }

      const detailedCost = calculateTokensCostDetailed(modelId, {
        promptTokens,
        completionTokens,
        cachedTokens,
        reasoningTokens,
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
          reasoningTokens,
          totalTokens,
          modelId,
          provider: "openai",
          estimatedCostBaisa: detailedCost.costBaisa,
          estimatedCostUsd: detailedCost.costUsd,
          requestId,
        },
        modelId,
        attemptsCount: 1,
      };
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string; name?: string };
      const safeMessage = sanitizeErrorMessage(errorObj?.message || "Unknown OpenAI execution error");

      if (errorObj?.name === "AbortError") {
        return { ok: false, code: "UNAVAILABLE", message: "Request timed out or was aborted" };
      }
      if (errorObj?.status === 401) {
        return { ok: false, code: "UNAUTHENTICATED", message: "Invalid OpenAI API Key" };
      }
      if (errorObj?.status === 403) {
        return { ok: false, code: "FORBIDDEN", message: safeMessage };
      }
      if (errorObj?.status === 404) {
        return { ok: false, code: "UNAVAILABLE", message: `Model not found or unavailable: ${safeMessage}` };
      }
      if (errorObj?.status === 429) {
        return { ok: false, code: "UNAVAILABLE", message: "OpenAI rate limit or quota exceeded" };
      }

      return {
        ok: false,
        code: "UNAVAILABLE",
        message: safeMessage,
      };
    }
  }
}

import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { getSecureProviderKey } from "@/lib/answers/config/env";
import type { AIModelId, AIProviderName } from "@/lib/answers/types";

export type ModelAccessStatus =
  | "AVAILABLE_AND_AUTHORIZED"
  | "RESTRICTED_FOR_ACCOUNT"
  | "NOT_FOUND_ON_ENDPOINT"
  | "AUTH_KEY_INVALID"
  | "KEY_MISSING"
  | "NETWORK_ERROR";

export interface ModelAvailabilityCheckResult {
  modelId: AIModelId;
  provider: AIProviderName;
  keyConfigured: boolean;
  status: ModelAccessStatus;
  httpStatus?: number;
  message: string;
  checkedAt: string;
}

export interface DiagnosticsSummary {
  allConfigured: boolean;
  results: Record<AIModelId, ModelAvailabilityCheckResult>;
  checkedAt: string;
}

function maskKey(key: string | null): string {
  if (!key) return "NOT_SET";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Checks availability and account permissions for an OpenAI model.
 * Distinguishes between global existence and account-level authorization.
 */
export async function checkOpenAIModelAvailability(
  modelId: "gpt-6-luna" | "gpt-6.1-sol",
  injectedClient?: OpenAI,
): Promise<ModelAvailabilityCheckResult> {
  const apiKey = getSecureProviderKey("openai");
  const keyConfigured = Boolean(apiKey || injectedClient);

  if (!keyConfigured) {
    return {
      modelId,
      provider: "openai",
      keyConfigured: false,
      status: "KEY_MISSING",
      message: "OpenAI API Key is not configured in server environment (.env.local).",
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const client = injectedClient || new OpenAI({ apiKey: apiKey! });
    // Use models.retrieve to check metadata without consuming tokens
    await client.models.retrieve(modelId);

    return {
      modelId,
      provider: "openai",
      keyConfigured: true,
      status: "AVAILABLE_AND_AUTHORIZED",
      httpStatus: 200,
      message: `Model '${modelId}' is registered and fully authorized for this account.`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const errorObj = err as { status?: number; message?: string };
    const status = errorObj?.status;
    const msg = errorObj?.message || "";

    if (status === 401) {
      return {
        modelId,
        provider: "openai",
        keyConfigured: true,
        status: "AUTH_KEY_INVALID",
        httpStatus: 401,
        message: "API key was rejected by OpenAI (401 Unauthorized).",
        checkedAt: new Date().toISOString(),
      };
    }

    if (status === 403) {
      return {
        modelId,
        provider: "openai",
        keyConfigured: true,
        status: "RESTRICTED_FOR_ACCOUNT",
        httpStatus: 403,
        message: `Model '${modelId}' exists officially, but access is restricted for this account tier/organization (403 Forbidden).`,
        checkedAt: new Date().toISOString(),
      };
    }

    if (status === 404) {
      return {
        modelId,
        provider: "openai",
        keyConfigured: true,
        status: "NOT_FOUND_ON_ENDPOINT",
        httpStatus: 404,
        message: `Model '${modelId}' is not found on the targeted endpoint (404 Not Found).`,
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      modelId,
      provider: "openai",
      keyConfigured: true,
      status: "NETWORK_ERROR",
      httpStatus: status,
      message: `Failed to verify model '${modelId}': ${msg.slice(0, 100)}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

/**
 * Checks availability and account permissions for Gemini 3.8 Flash.
 */
export async function checkGeminiModelAvailability(
  modelId: "gemini-3.8-flash" = "gemini-3.8-flash",
  injectedClient?: GoogleGenAI,
): Promise<ModelAvailabilityCheckResult> {
  const apiKey = getSecureProviderKey("google");
  const keyConfigured = Boolean(apiKey || injectedClient);

  if (!keyConfigured) {
    return {
      modelId,
      provider: "google",
      keyConfigured: false,
      status: "KEY_MISSING",
      message: "Google Gemini API Key is not configured in server environment (.env.local).",
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const client = injectedClient || new GoogleGenAI({ apiKey: apiKey! });
    // Use models.get to inspect model descriptor without generating text or spending tokens
    await client.models.get({ model: `models/${modelId}` });

    return {
      modelId,
      provider: "google",
      keyConfigured: true,
      status: "AVAILABLE_AND_AUTHORIZED",
      httpStatus: 200,
      message: `Model '${modelId}' is registered and fully authorized for this Google account.`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const errorObj = err as { status?: number; message?: string };
    const status = errorObj?.status;
    const msg = errorObj?.message || "";

    if (status === 401 || status === 403) {
      const isKeyProblem = msg.includes("API_KEY_INVALID") || msg.includes("UNAUTHENTICATED");
      return {
        modelId,
        provider: "google",
        keyConfigured: true,
        status: isKeyProblem ? "AUTH_KEY_INVALID" : "RESTRICTED_FOR_ACCOUNT",
        httpStatus: status,
        message: isKeyProblem
          ? "API Key rejected by Google."
          : `Model '${modelId}' exists, but this account/project lacks access permissions (403 Forbidden).`,
        checkedAt: new Date().toISOString(),
      };
    }

    if (status === 404) {
      return {
        modelId,
        provider: "google",
        keyConfigured: true,
        status: "NOT_FOUND_ON_ENDPOINT",
        httpStatus: 404,
        message: `Model '${modelId}' is not found in the Google model catalog for this endpoint (404 Not Found).`,
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      modelId,
      provider: "google",
      keyConfigured: true,
      status: "NETWORK_ERROR",
      httpStatus: status,
      message: `Failed to verify model '${modelId}': ${msg.slice(0, 100)}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

/**
 * Diagnostic runner checking all three models and provider credentials.
 * Never prints or leaks raw secret keys.
 */
export async function checkAllModelsAvailability(clients?: {
  openai?: OpenAI;
  gemini?: GoogleGenAI;
}): Promise<DiagnosticsSummary> {
  const [luna, sol, gemini] = await Promise.all([
    checkOpenAIModelAvailability("gpt-6-luna", clients?.openai),
    checkOpenAIModelAvailability("gpt-6.1-sol", clients?.openai),
    checkGeminiModelAvailability("gemini-3.8-flash", clients?.gemini),
  ]);

  const allConfigured = luna.keyConfigured && sol.keyConfigured && gemini.keyConfigured;

  return {
    allConfigured,
    results: {
      "gpt-6-luna": luna,
      "gpt-6.1-sol": sol,
      "gemini-3.8-flash": gemini,
    },
    checkedAt: new Date().toISOString(),
  };
}

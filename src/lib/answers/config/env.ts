import "server-only";
import type { AIProviderName } from "@/lib/answers/types";

/**
 * Server-only secure provider environment accessor.
 * Prevents key access in client/browser environments.
 */
export function getSecureProviderKey(provider: AIProviderName): string | null {
  if (typeof window !== "undefined") {
    // Browser environment protection: Never return keys on client
    return null;
  }

  if (provider === "openai") {
    const key = process.env.AI_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    return key?.trim() || null;
  }

  if (provider === "google") {
    const key = process.env.AI_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    return key?.trim() || null;
  }

  return null;
}

export function isProviderKeyConfigured(provider: AIProviderName): boolean {
  return Boolean(getSecureProviderKey(provider));
}

export function getGeminiModelId(): string {
  if (typeof window !== "undefined") {
    return "gemini-3.8-flash";
  }
  return process.env.AI_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
}

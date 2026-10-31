import "server-only";
import { GeminiAnswerAdapter } from "@/lib/answers/adapters/gemini";
import { getSecureProviderKey } from "@/lib/answers/config/env";
import type { AnswerProvider } from "@/lib/answers/types";

let providerInstance: AnswerProvider | null = null;
/** When set (including null), tests pin the provider and skip env-key auto-create. */
let testingProvider: AnswerProvider | null | undefined = undefined;

/**
 * Returns the configured AnswerProvider (GeminiAnswerAdapter).
 * If no API key is configured, returns null (signals NEEDS_SETUP).
 * Keys are kept strictly server-only and never reach the browser or logs.
 */
export function getAnswerProvider(): AnswerProvider | null {
  if (testingProvider !== undefined) return testingProvider;
  if (providerInstance) return providerInstance;
  const apiKey = getSecureProviderKey("google");
  if (!apiKey) return null;
  providerInstance = new GeminiAnswerAdapter({ apiKey });
  return providerInstance;
}

/**
 * Injects a test provider for hermetic testing without making external network calls.
 * Pass null to force NEEDS_SETUP (do not recreate from a local API key).
 */
export function setAnswerProviderForTesting(provider: AnswerProvider | null): void {
  testingProvider = provider;
  providerInstance = provider;
}

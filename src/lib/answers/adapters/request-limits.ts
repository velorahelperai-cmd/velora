import "server-only";
import type { AnswerProviderRequest } from "../types";

/** Output includes reasoning. Retries are owned by the router, never by the SDK. */
export function providerRequestLimits(input: AnswerProviderRequest) {
  const maxOutputTokens = input.maxOutputTokens ?? 512;
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4096 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) return null;
  return { maxOutputTokens, timeoutMs };
}

export function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

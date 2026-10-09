import type { AIModelId } from "../types";

/** Preserve optional legacy metadata; a different actual model is never priced as the requested one. */
export function matchesRequestedModel(actual: unknown, requested: AIModelId): boolean {
  if (actual === undefined || actual === null) return true;
  if (typeof actual !== "string" || !actual.trim()) return false;
  const normalized = requested === "gemini-3.8-flash" ? actual.replace(/^models\//, "") : actual;
  if (normalized === requested) return true;
  const suffix = normalized.startsWith(`${requested}-`) ? normalized.slice(requested.length + 1) : "";
  return requested === "gemini-3.8-flash" ? /^\d{3}$/.test(suffix) : /^\d{4}-\d{2}-\d{2}$/.test(suffix);
}

/** Classify Auth provider failures without logging provider text or secrets. */

export type ProviderFailureKind = "confirmed_reject" | "unknown_transport";

export function classifyProviderAuthFailure(error: {
  status?: number | null;
  code?: string | null;
  message?: string | null;
  name?: string | null;
} | null | undefined): ProviderFailureKind {
  if (!error) return "unknown_transport";
  const status = typeof error.status === "number" ? error.status : NaN;
  // 429 is a confirmed provider disposition for this attempt (retry with a new gesture).
  if (status === 408 || (status >= 500 && status <= 599)) return "unknown_transport";
  const code = typeof error.code === "string" ? error.code.toLowerCase() : "";
  if (code.includes("timeout") || code.includes("network")) {
    return "unknown_transport";
  }
  const name = typeof error.name === "string" ? error.name.toLowerCase() : "";
  if (name.includes("fetch") || name.includes("network") || name.includes("abort")) return "unknown_transport";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (
    message.includes("fetch failed")
    || message.includes("network")
    || message.includes("timeout")
    || message.includes("econnreset")
    || message.includes("socket")
  ) {
    return "unknown_transport";
  }
  return "confirmed_reject";
}

export function actionCodeForProviderFailure(kind: ProviderFailureKind): "AUTH_ERROR" | "UNAVAILABLE" {
  return kind === "unknown_transport" ? "UNAVAILABLE" : "AUTH_ERROR";
}

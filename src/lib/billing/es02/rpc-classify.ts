/**
 * PostgREST/SDK failure classification for ES02 write attempts.
 * After an attempted mutating RPC, uncertain transport → UNKNOWN (not false UNAVAILABLE).
 */

export type Es02RpcObservation = {
  data: unknown;
  error: unknown;
  status?: number;
  statusText?: string;
};

export function classifyEs02RpcFailure(
  observation: Es02RpcObservation,
  uncertainAfterAttempt: boolean,
): "FORBIDDEN" | "UNKNOWN" | "UNAVAILABLE" {
  const error = observation.error;
  if (typeof error === "object" && error && "code" in error && (error as { code?: unknown }).code === "42501") {
    return "FORBIDDEN";
  }
  const status =
    typeof observation.status === "number"
      ? observation.status
      : typeof error === "object" && error && "status" in error
        ? Number((error as { status?: unknown }).status)
        : NaN;
  const statusText =
    typeof observation.statusText === "string"
      ? observation.statusText
      : typeof error === "object" && error && "statusText" in error
        ? String((error as { statusText?: unknown }).statusText ?? "")
        : "";
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : typeof error === "string"
        ? error
        : "";
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const blob = `${statusText} ${message}`;
  if (uncertainAfterAttempt) {
    if (status === 502 || status === 503 || status === 504 || status === 0) return "UNKNOWN";
    if (/service unavailable|bad gateway|gateway timeout/i.test(blob)) return "UNKNOWN";
    if (code === "PGRST301" || code === "57014" || code === "08006" || code === "08001" || code === "57P01") {
      return "UNKNOWN";
    }
    if (/fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(message)) return "UNKNOWN";
    try {
      const parsed = JSON.parse(message) as { message?: string; code?: number };
      if (parsed && (parsed.code === 502 || parsed.code === 503 || parsed.code === 504)) return "UNKNOWN";
      if (parsed?.message && /service unavailable|bad gateway|gateway timeout/i.test(parsed.message)) {
        return "UNKNOWN";
      }
    } catch {
      /* plain text */
    }
  }
  return "UNAVAILABLE";
}

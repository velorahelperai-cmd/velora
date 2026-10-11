/** Server-reader diagnostics. Never pass request data or raw error text to the logger. */
export type InboxReadStage =
  | "initial_access" | "initial_scope" | "initial_capability" | "initial_page"
  | "initial_timezone" | "initial_assignees" | "final_access" | "final_scope" | "final_capability" | "initial_worklist"
  | "page_access" | "page_capability" | "page_scope" | "page_rpc" | "page_shape" | "page_binding" | "page_decode"
  | "scope_rpc" | "read_capability_rpc";
type DiagnosticCode =
  | "UNAUTHENTICATED" | "UNVERIFIED" | "NO_COMPANY" | "SCOPE_CHANGED" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE"
  | "UNKNOWN_SCOPE" | "READ_NOT_CONFIRMED" | "QUERY_ERROR" | "RPC_ERROR" | "INVALID_RESPONSE"
  | "NULL_RESULT" | "FALSE_RESULT" | "EXCEPTION";
const ERROR_CODES = ["PGRST202", "PGRST203", "PGRST301", "42501", "42703", "42P01", "42883", "57014", "55P03"] as const;

export function reportInboxReadFailure(stage: InboxReadStage, code: DiagnosticCode, error?: unknown) {
  try {
    const rawCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const knownCode = ERROR_CODES.find(value => value === rawCode);
    console.warn("whatsapp.inbox_read_failed", {
      stage, code, ...(error === undefined ? {} : { error_code: knownCode ?? "OTHER" }),
    });
  } catch {
    // Diagnostic failure must not affect authorization or the public result.
  }
}

import { readAuthCorrelation } from "./correlation.mjs";
import { diagnosticOperations, diagnosticStages, diagnosticCodes, type DiagnosticOperation, type DiagnosticStage, type DiagnosticCode, type DiagnosticDetail } from "./contract";

const SERVICE = "velora.auth";

/** Fixed vocabulary only. Never accepts an error, auth input or provider message; correlation is validated separately. */
export function beginDiagnostic(operation: DiagnosticOperation, incoming?: unknown) {
  const op = diagnosticOperations.includes(operation) ? operation : "unknown";
  const parent = readAuthCorrelation(incoming);
  const reference = parent?.request_id ?? `VEL-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  const trace_id = parent?.trace_id ?? crypto.randomUUID().replaceAll("-", "");
  const span_id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const started = performance.now();
  let stage: DiagnosticStage = "input";
  function log(code: DiagnosticCode, at: DiagnosticStage = stage): DiagnosticDetail {
    const safeCode = diagnosticCodes.includes(code) ? code : "UNEXPECTED_FAILURE";
    const safeStage = diagnosticStages.includes(at) ? at : "unknown";
    const detail = { reference, operation: op, stage: safeStage, code: safeCode };
    const elapsed = performance.now() - started;
    const duration_ms = Number.isFinite(elapsed) ? Math.min(86400000, Math.max(0, Math.round(elapsed))) : 0;
    const level =
      safeCode === "OK" || safeCode === "STARTED" ? "info" : (safeCode === "UNAVAILABLE" || safeCode === "OUTCOME_UNKNOWN") ? "warn" : "error";
    try {
      // LOG-001 envelope + support reference. Return value stays DiagnosticDetail-only.
      console.info(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: SERVICE,
        request_id: reference,
        trace_id,
        span_id,
        parent_span_id: parent?.parent_span_id ?? null,
        event: `auth.${op}.${safeStage}`,
        stage: safeStage,
        error_code: safeCode === "OK" || safeCode === "STARTED" ? null : safeCode,
        duration_ms,
        reference,
        operation: op,
        code: safeCode,
      }));
    } catch { /* Diagnostics never change the operation's result. */ }
    return detail;
  }
  return {
    reference,
    get correlation() { return { request_id: reference, trace_id, parent_span_id: span_id }; },
    get logContext() { return { request_id: reference, trace_id, span_id }; },
    stage(next: DiagnosticStage) { stage = diagnosticStages.includes(next) ? next : "unknown"; log("STARTED"); },
    event(at: DiagnosticStage, code: DiagnosticCode) { return log(code, at); },
    finish(code: DiagnosticCode) { return log(code); },
  };
}

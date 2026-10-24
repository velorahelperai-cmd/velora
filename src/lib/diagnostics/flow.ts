import { diagnosticOperations, diagnosticStages, diagnosticCodes, type DiagnosticOperation, type DiagnosticStage, type DiagnosticCode, type DiagnosticDetail } from "./contract";

const SERVICE = "velora.auth";

/** Fixed vocabulary only. Never accepts an error, input, identifier or provider message. */
export function beginDiagnostic(operation: DiagnosticOperation) {
  const op = diagnosticOperations.includes(operation) ? operation : "unknown";
  const reference = `VEL-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  const started = performance.now();
  let stage: DiagnosticStage = "input";
  function log(code: DiagnosticCode, at: DiagnosticStage = stage): DiagnosticDetail {
    const safeCode = diagnosticCodes.includes(code) ? code : "UNEXPECTED_FAILURE";
    const safeStage = diagnosticStages.includes(at) ? at : "unknown";
    const detail = { reference, operation: op, stage: safeStage, code: safeCode };
    const elapsed = performance.now() - started;
    const duration_ms = Number.isFinite(elapsed) ? Math.min(86400000, Math.max(0, Math.round(elapsed))) : 0;
    const level =
      safeCode === "OK" || safeCode === "STARTED" ? "info" : safeCode === "UNAVAILABLE" ? "warn" : "error";
    try {
      // LOG-001 envelope + support reference. Return value stays DiagnosticDetail-only.
      console.info(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: SERVICE,
        request_id: reference,
        trace_id: null,
        span_id: null,
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
    stage(next: DiagnosticStage) { stage = diagnosticStages.includes(next) ? next : "unknown"; log("STARTED"); },
    event(at: DiagnosticStage, code: DiagnosticCode) { return log(code, at); },
    finish(code: DiagnosticCode) { return log(code); },
  };
}

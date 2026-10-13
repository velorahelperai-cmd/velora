import { diagnosticOperations, diagnosticStages, diagnosticCodes, type DiagnosticOperation, type DiagnosticStage, type DiagnosticCode, type DiagnosticDetail } from "./contract";

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
    const durationMs = Number.isFinite(elapsed) ? Math.min(86400000, Math.max(0, Math.round(elapsed))) : 0;
    try { console.info(JSON.stringify({ ...detail, durationMs })); } catch { /* Diagnostics never change the operation's result. */ }
    return detail;
  }
  return {
    reference,
    stage(next: DiagnosticStage) { stage = diagnosticStages.includes(next) ? next : "unknown"; log("STARTED"); },
    event(at: DiagnosticStage, code: DiagnosticCode) { return log(code, at); },
    finish(code: DiagnosticCode) { return log(code); },
  };
}

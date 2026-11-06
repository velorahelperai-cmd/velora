/**
 * Inbound worker entrypoint — callable execution through the unified integration pipeline.
 * Mandatory IntegrationPorts required; headless execution without ports is strictly rejected.
 */

import {
  runPersistedInboundJob,
  type IntegrationPorts,
  type IntegrationOutcome,
} from "./integration-worker";

export type WorkerRunResult = IntegrationOutcome;

function blocked(code: string): WorkerRunResult {
  return { ok: false, code, jobCompleted: false, sendAccepted: false, delivered: false };
}

/**
 * Resume-safe entry for claimed WhatsApp inbound jobs.
 * Enforces mandatory integration ports for database persistence, rate-limiting, AI execution, and transport.
 */
export async function runInboundWorkerAnswer(
  input: {
    jobId: string;
    claimToken: string;
    companyId: string;
    locale?: "ar" | "en";
  },
  ports: IntegrationPorts,
): Promise<WorkerRunResult> {
  if (!ports) return blocked("PORTS_REQUIRED");
  if (!input.jobId?.trim() || !input.claimToken?.trim() || !input.companyId?.trim()) return blocked("INVALID_INPUT");
  return runPersistedInboundJob(input, ports);
}

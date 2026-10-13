import "server-only";
import type { ClaimResult, EmailClaim, EmailOutcome, EmailWorkerResult } from "./contracts";
export type EmailPorts = { claim: () => Promise<ClaimResult>; finish: (claim: EmailClaim, result: EmailOutcome) => Promise<boolean>; send: (claim: EmailClaim) => Promise<EmailOutcome> };
/** One durable claim per invocation. Claimed or ambiguous requests are never replayed automatically. */
export async function runEmailWorker(enabled: boolean, ports: EmailPorts): Promise<EmailWorkerResult> {
  if (!enabled) return { ok: false, code: "EMAIL_DISABLED" };
  let claimed: ClaimResult;
  try { claimed = await ports.claim(); } catch { return { ok: false, code: "EMAIL_STORE_UNAVAILABLE" }; }
  if (!claimed.ok) return claimed;
  if (!claimed.claim) return { ok: true, processed: 0, accepted: 0, delivered: 0, reconciliationRequired: false };
  let result: EmailOutcome;
  try { result = await ports.send(claimed.claim); } catch { result = { kind: "reconciliation_required", code: "RESEND_OUTCOME_UNKNOWN" }; }
  let saved = false;
  try { saved = await ports.finish(claimed.claim, result); } catch { /* A permanent claim prevents another send. */ }
  if (!saved) return { ok: false, code: "EMAIL_RECONCILIATION_REQUIRED" };
  return { ok: true, processed: 1, accepted: result.kind === "accepted" ? 1 : 0, delivered: 0, reconciliationRequired: result.kind === "reconciliation_required" };
}

import type {
  AttemptBinding, CompletionInput, ConnectionFailure, ConnectionFailureCode,
  ConnectionPorts, ConnectionProgress, ConnectionResult, InstagramIdentity, ProviderSuccess,
} from "./connection-contracts";

const failure = (code: ConnectionFailureCode): ConnectionFailure => ({ ok: false, code });
const reconcile = (): ConnectionFailure => failure("RECONCILIATION_REQUIRED");
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const keys = ["companyId", "userId", "sessionId", "attemptId", "appId", "contractId"] as const;
function validBinding(value: unknown): value is AttemptBinding {
  return object(value) && keys.every(key => text(value[key])) && Number.isSafeInteger(value.generation) && (value.generation as number) > 0;
}
function matches(value: unknown, binding: AttemptBinding): value is AttemptBinding {
  return validBinding(value) && keys.every(key => value[key] === binding[key]) && value.generation === binding.generation;
}
function safeFailure(value: unknown): ConnectionFailure {
  const code = object(value) ? value.code : null;
  switch (code) {
    case "FORBIDDEN": case "EXPIRED": case "CONSUMED": case "INVALID_INPUT": case "UNAVAILABLE": case "RECONCILIATION_REQUIRED": case "ACCOUNT_MISMATCH": return failure(code);
    default: return reconcile();
  }
}
function verifiedShape(value: unknown, binding: AttemptBinding): value is ProviderSuccess {
  if (!object(value) || value.ok !== true || !text(value.accessToken) || !object(value.evidence)) return false;
  const proof = value.evidence;
  return proof.appId === binding.appId && proof.contractId === binding.contractId && text(proof.accountId)
    && Array.isArray(proof.permissions) && proof.permissions.length > 0 && proof.permissions.every(text)
    && text(proof.expiresAt) && Number.isFinite(Date.parse(proof.expiresAt)) && Date.parse(proof.expiresAt) > Date.now();
}

/**
 * Server-internal orchestration; NOT a Server Action or a live provider/DB adapter.
 * Identity/binding come from future verified server action/store, never the browser.
 * A durable claim is the only exchange authority. Recovery reads do not dispatch.
 * No logging, polling, lease reclamation or automatic provider/code exchange retry.
 */
export async function completeInstagramConnection(
  identity: InstagramIdentity, input: CompletionInput, suppliedBinding: AttemptBinding, ports: ConnectionPorts,
): Promise<ConnectionResult> {
  // Port data access can itself throw; never let provider diagnostics escape.
  // Await also catches rejected async progress handling. Recovery remains explicit.
  try { return await runCompletion(identity, input, suppliedBinding, ports); } catch { return reconcile(); }
}

async function runCompletion(
  identity: InstagramIdentity, input: CompletionInput, suppliedBinding: AttemptBinding, ports: ConnectionPorts,
): Promise<ConnectionResult> {
  if (!object(identity) || ![identity.companyId, identity.userId, identity.sessionId].every(text)
    || !object(input) || ![input.attemptId, input.state, input.code].every(text) || !validBinding(suppliedBinding)) return failure("INVALID_INPUT");
  // Capture before any await; caller mutation cannot change a claimed tenant/code.
  const binding: AttemptBinding = Object.freeze({
    companyId: suppliedBinding.companyId, userId: suppliedBinding.userId, sessionId: suppliedBinding.sessionId,
    attemptId: suppliedBinding.attemptId, generation: suppliedBinding.generation,
    appId: suppliedBinding.appId, contractId: suppliedBinding.contractId,
  });
  const state = input.state, code = input.code;
  if (identity.companyId !== binding.companyId || identity.userId !== binding.userId || identity.sessionId !== binding.sessionId
    || input.attemptId !== binding.attemptId) return failure("FORBIDDEN");

  // At most one authoritative read per uncertain port outcome, no recursive retry.
  async function read(allowFinalize: boolean): Promise<ConnectionResult> {
    try { return progressResult(await ports.readProgress(binding), allowFinalize); } catch { return reconcile(); }
  }
  async function finalize(receipt: string): Promise<ConnectionResult> {
    try {
      const subscription = await ports.subscribe(binding, receipt);
      if (!object(subscription) || subscription.ok !== true) return safeFailure(subscription);
      const result = await ports.finalize(binding, receipt);
      if (object(result) && result.ok === true && text(result.linkId)) return { ok: true, linkId: result.linkId };
      const denied = safeFailure(result);
      return denied.code === "RECONCILIATION_REQUIRED" || denied.code === "UNAVAILABLE" ? read(false) : denied;
    } catch { return read(false); }
  }
  async function progressResult(progress: ConnectionProgress, allowFinalize: boolean): Promise<ConnectionResult> {
    if (!object(progress) || !matches(progress.binding, binding)) return failure("FORBIDDEN");
    switch (progress.kind) {
      case "bound": return text(progress.linkId) ? { ok: true, linkId: progress.linkId } : reconcile();
      case "vault_staged": return allowFinalize && text(progress.stageReceipt) ? finalize(progress.stageReceipt) : reconcile();
      case "expired": return failure("EXPIRED");
      case "rejected": case "cancelled": return failure("CONSUMED");
      default: return reconcile();
    }
  }
  async function settle(outcome: "unknown" | "rejected", rejection: ConnectionFailureCode = "CONSUMED"): Promise<ConnectionResult> {
    try {
      const progress = await ports.settleClaim(binding, outcome);
      if (object(progress) && matches(progress.binding, binding) && progress.kind === "rejected") return failure(rejection);
      return progressResult(progress, true);
    } catch { return read(true); }
  }

  let claim;
  try { claim = await ports.claim(binding, state); } catch { return read(true); }
  if (!object(claim)) return reconcile();
  if ("ok" in claim) {
    const denied = safeFailure(claim);
    return denied.code === "RECONCILIATION_REQUIRED" ? read(true) : denied;
  }
  if (claim.kind === "existing") return progressResult(claim.progress, true);
  if (claim.kind !== "claimed" || claim.committed !== true) return reconcile();
  if (!matches(claim.binding, binding)) return failure("FORBIDDEN");

  let exchanged;
  try { exchanged = await ports.exchange(code, binding); } catch { return settle("unknown"); }
  if (object(exchanged) && exchanged.ok === false) return settle(exchanged.code === "REJECTED" ? "rejected" : "unknown");
  if (!verifiedShape(exchanged, binding)) return settle("rejected", "FORBIDDEN");
  // Allowlist server-side stage material too; never pass raw provider diagnostics.
  const success: ProviderSuccess = Object.freeze({
    ok: true, accessToken: exchanged.accessToken,
    evidence: Object.freeze({ appId: exchanged.evidence.appId, accountId: exchanged.evidence.accountId,
      permissions: Object.freeze([...exchanged.evidence.permissions]), expiresAt: exchanged.evidence.expiresAt, contractId: exchanged.evidence.contractId,
      ...(exchanged.evidence.username?{username:exchanged.evidence.username}:{}) }),
  });
  try {
    const staged = await ports.stage(binding, success);
    if (object(staged) && "stageReceipt" in staged && text(staged.stageReceipt)) return finalize(staged.stageReceipt);
    const denied = safeFailure(staged);
    return denied.code === "RECONCILIATION_REQUIRED" || denied.code === "UNAVAILABLE" ? read(true) : denied;
  } catch { return read(true); }
}

import "server-only";
import type { CoexistenceProviderConfig, CoexistenceProviderInput, CoexistenceProviderFailureCode, CoexistencePreparedResult, PreparedCoexistenceSignup, CoexistenceSubscriptionResult, UnsubscribedCoexistenceProof, SubscribedCoexistenceProof } from "./provider";

export type CoexistenceSignupIdentity = { companyId: string; userId: string; sessionId: string };
export type CoexistenceSignupCompletionInput = { attemptId: string; nonce: string; code: string; confirmedPhoneNumber?: string; wabaId?: string; phoneNumberId?: string };
export type CoexistenceSignupClaim = { ok: true; attempt_id: string; company_id: string; user_id: string; session_id: string; app_id: string; config_id: string; graph_version: string; keep_on_phone: true; expected_phone_number: string | null };
export type CoexistenceSignupFailureCode = CoexistenceProviderFailureCode | "FORBIDDEN" | "EXPIRED" | "CONSUMED" | "UNAVAILABLE";
export type CoexistenceSignupFailure = { ok: false; code: CoexistenceSignupFailureCode };
export type CoexistenceSignupPorts = {
  claim: () => Promise<CoexistenceSignupClaim | CoexistenceSignupFailure>;
  prepare: (input: CoexistenceProviderInput) => Promise<CoexistencePreparedResult>;
  checkpoint: (claim: CoexistenceSignupClaim, token: string, proof: UnsubscribedCoexistenceProof) => Promise<{ ok: true } | CoexistenceSignupFailure>;
  subscribe: (prepared: PreparedCoexistenceSignup) => Promise<CoexistenceSubscriptionResult>;
  finalize: (claim: CoexistenceSignupClaim, proof: SubscribedCoexistenceProof) => Promise<{ ok: true } | CoexistenceSignupFailure>;
  fail: (code: CoexistenceSignupFailureCode) => Promise<void>;
};

function completionPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64 || !/^[+\d ()-]+$/.test(value)) return null;
  const compact = value.replace(/[ ()-]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(compact) ? compact : null;
}

/** Pre-entered number (legacy) must match; otherwise Meta's phone_number_id is required and the number is derived from Meta. */
function expectedOk(expected: string | null, input: CoexistenceSignupCompletionInput): boolean {
  if (expected === null) return input.confirmedPhoneNumber == null && typeof input.phoneNumberId === "string" && /^[1-9]\d{0,31}$/.test(input.phoneNumberId);
  return /^\+[1-9]\d{6,14}$/.test(expected) && completionPhone(input.confirmedPhoneNumber) === expected;
}

/** Auth identity and expected number come from the bound, one-use server attempt. */
export async function finishCoexistenceSignup(identity: CoexistenceSignupIdentity, input: CoexistenceSignupCompletionInput, config: CoexistenceProviderConfig & { configId: string }, ports: CoexistenceSignupPorts): Promise<{ ok: true } | CoexistenceSignupFailure> {
  if (!config.enabled) return { ok: false, code: "NEEDS_SETUP" };
  let claimed = false;
  let prepareStarted = false;
  let checkpointStarted = false;
  const fail = async (code: CoexistenceSignupFailureCode): Promise<CoexistenceSignupFailure> => {
    try { await ports.fail(code); } catch { /* Never replay provider work to repair local status. */ }
    return { ok: false, code };
  };
  try {
    const claim = await ports.claim();
    if (!claim.ok) return claim;
    if (claim.attempt_id !== input.attemptId || claim.company_id !== identity.companyId || claim.user_id !== identity.userId || claim.session_id !== identity.sessionId || claim.app_id !== config.appId || claim.config_id !== config.configId || claim.graph_version !== config.graphVersion || claim.keep_on_phone !== true || !expectedOk(claim.expected_phone_number, input)) return { ok: false, code: "FORBIDDEN" };
    claimed = true;
    // Code exchange is an external authorization mutation even before checkpoint.
    prepareStarted = true;
    const prepared = await ports.prepare({ code: input.code, ...(input.wabaId !== undefined ? { wabaId: input.wabaId } : {}), ...(input.phoneNumberId !== undefined ? { phoneNumberId: input.phoneNumberId } : {}), ...(claim.expected_phone_number ? { confirmedPhoneNumber: claim.expected_phone_number } : {}) });
    if (!prepared.ok) return await fail(prepared.code);
    checkpointStarted = true;
    const checkpoint = await ports.checkpoint(claim, prepared.accessToken, prepared.proof);
    if (!checkpoint.ok) return await fail("RECONCILIATION_REQUIRED");
    const subscribed = await ports.subscribe(prepared);
    if (!subscribed.ok) return await fail("RECONCILIATION_REQUIRED");
    const finalized = await ports.finalize(claim, subscribed.proof);
    if (!finalized.ok) return await fail("RECONCILIATION_REQUIRED");
    return { ok: true };
  } catch {
    if (prepareStarted || checkpointStarted) return await fail("RECONCILIATION_REQUIRED");
    if (claimed) return await fail("UNAVAILABLE");
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/** Server-internal OAuth ports. No provider, database or Vault implementation here. */
export type InstagramIdentity = Readonly<{ companyId: string; userId: string; sessionId: string }>;
export type CompletionInput = Readonly<{ attemptId: string; state: string; code: string }>;
export type AttemptBinding = InstagramIdentity & Readonly<{
  attemptId: string; generation: number; appId: string; contractId: string;
}>;

/** Durable reads expose no token/code/state or Vault contents. Receipts stay internal. */
export type ConnectionProgress = Readonly<{ binding: AttemptBinding }> & (
  | Readonly<{ kind: "pending" | "claimed" | "rejected" | "unknown" | "expired" | "cancelled" }>
  | Readonly<{ kind: "vault_staged"; stageReceipt: string }>
  | Readonly<{ kind: "bound"; linkId: string }>
);
export type ConnectionFailureCode = "FORBIDDEN" | "EXPIRED" | "CONSUMED" | "INVALID_INPUT" | "UNAVAILABLE" | "RECONCILIATION_REQUIRED";
export type ConnectionFailure = Readonly<{ ok: false; code: ConnectionFailureCode; diagnostic?: import('@/lib/diagnostics/contract').DiagnosticDetail }>;
/** The only result allowed to cross the future server-action/client boundary. */
export type ConnectionResult = Readonly<{ ok: true; linkId: string }> | ConnectionFailure;
export type ProviderBindingEvidence = Readonly<{
  appId: string; accountId: string; permissions: readonly string[]; expiresAt: string; contractId: string;
}>;
/** Secret-bearing value exists only between server-side exchange and Vault staging. */
export type ProviderSuccess = Readonly<{ ok: true; accessToken: string; evidence: ProviderBindingEvidence }>;
export type ProviderResult = ProviderSuccess | Readonly<{ ok: false; code: "REJECTED" | "UNKNOWN" }>;
export type ClaimResult =
  | Readonly<{ kind: "claimed"; committed: true; binding: AttemptBinding }>
  | Readonly<{ kind: "existing"; progress: ConnectionProgress }>
  | ConnectionFailure;

/**
 * These are REQUIRED real store/adapter guarantees, not assertions proven by mocks.
 * All store ports must validate the exact persisted company/user/native session/
 * attempt/generation/app/contract binding and current ownership/company authority.
 * Generation is server-issued; a browser cannot select it or confer ownership.
 * Reads are authoritative committed progress, never cache/in-memory durability.
 * SQL/Vault concurrency, privilege isolation and provider proof need later tests.
 */
export type ConnectionPorts = Readonly<{
  readProgress(binding: AttemptBinding): Promise<ConnectionProgress>;
  /**
   * Atomically validate the nonce hash, expiry, current owner and native/app session,
   * consume this exact attempt once, then COMMIT before returning claimed:true.
   * Only one caller can receive a fresh committed claim, including concurrent calls
   * by the same session. Others return existing or a known no-effect denial.
   * No lease expiry/reset/retry grants a second exchange. A transport exception or
   * RECONCILIATION_REQUIRED is ambiguous; neither authorizes provider dispatch.
   */
  claim(binding: AttemptBinding, state: string): Promise<ClaimResult>;
  /**
   * One provider attempt, no internal HTTP retry. The future pinned adapter proves
   * professional account/app/permission/expiry semantics before ProviderSuccess.
   * A dispatch timeout/throw is UNKNOWN, never evidence that exchange was rejected.
   */
  exchange(code: string, binding: AttemptBinding): Promise<ProviderResult>;
  /**
   * Recheck current binding/owner/native+app session/company/generation and evidence;
   * atomically COMMIT encrypted Vault material AND attempt vault_staged progress/
   * exact-bound opaque receipt. No receipt before commit, no token in logs/results.
   * Vault/store implementation must provide a real shared transaction or an equally
   * durable staged protocol; a process-local map is not sufficient. Known denial
   * makes no stage change; exception/UNAVAILABLE may mean a committed lost response.
   */
  stage(binding: AttemptBinding, success: ProviderSuccess): Promise<Readonly<{ stageReceipt: string }> | ConnectionFailure>;
  /** Establish messages subscription only after a committed, exact Vault stage.
   * The implementation must commit one subscription claim before its single POST,
   * retain ambiguous outcomes independently of OAuth, and require provider success
   * before returning ok. No automatic POST replay or undocumented GET recovery. */
  subscribe(binding: AttemptBinding, stageReceipt: string): Promise<Readonly<{ ok: true }> | ConnectionFailure>;
  /**
   * Revalidate exact receipt and current owner/native+app session/company/generation,
   * app/contract/evidence/expiry in the binding transaction. Enforce active-account
   * uniqueness across companies under a real database constraint/lock, not a prior
   * in-memory check. Atomically bind the staged secret/account and COMMIT bound with
   * a public, nonsecret linkId; replay returns that stored result. Denial never binds.
   */
  finalize(binding: AttemptBinding, stageReceipt: string): Promise<ConnectionResult>;
  /**
   * Atomic compare-and-set ONLY the matching claimed attempt to unknown/rejected.
   * Never overwrite vault_staged, bound or another terminal state/generation.
   * Return current committed progress even if CAS did not apply. No raw diagnostic,
   * token, state or code persistence. Exception is reconciled by one durable read.
   */
  settleClaim(binding: AttemptBinding, outcome: "unknown" | "rejected"): Promise<ConnectionProgress>;
}>;

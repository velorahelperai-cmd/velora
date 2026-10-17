import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  boundaryFingerprint,
  brokerEncryptionConfigured,
  decryptAdmissionHandle,
  decryptSecret,
  encryptAdmissionHandle,
  encryptSecret,
  newGenerationId,
  newOpaqueHandle,
  sha256Buffer,
} from "./crypto";
import { BROKER_COOKIE_PREFIX, BROKER_CONTRACT_VERSION, type BrokerCapability, type BrokerSessionStatus } from "./types";
import { brokerLog } from "./log";

export type RegistryRow = {
  id: string;
  handle_hash: string;
  cookie_name: string;
  generation: string;
  user_id: string;
  native_session_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: string;
  refresh_revision: number;
  auth_ordinal: number;
  auth_intent_id: string | null;
  parent_handle_hash: string | null;
  browser_lineage_id?: string | null;
  admission_scope?: "app" | "recovery" | null;
  status: BrokerSessionStatus;
  created_at?: string;
};

function adminOrNull() {
  return createAdminClient();
}

export function hashHex(value: string | Buffer): string {
  return sha256Buffer(value).toString("hex");
}

function encB64(plaintext: string): string | null {
  const buf = encryptSecret(plaintext);
  return buf ? buf.toString("base64") : null;
}

function decB64(value: string): string | null {
  try {
    return decryptSecret(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
}

/** Strict boolean: reject string "false"/"true" and other coercions (P07). */
function strictTrue(value: unknown): boolean {
  return value === true;
}

function receiptHandleMatchesHash(handle: string, expectedHashHex: string): boolean {
  return hashHex(handle) === expectedHashHex;
}

function failCapability(codes: string[], encryptionConfigured: boolean): BrokerCapability {
  return {
    ok: false,
    contractVersion: BROKER_CONTRACT_VERSION,
    revokeBoolean: false,
    idleWrappers: false,
    brokerRegistry: false,
    revokeAtOperation: false,
    refreshLease: false,
    admitOrdinal: false,
    admitAtomic: false,
    browserAttemptIssue: false,
    admit14arg: false,
    issueSeqColumn: false,
    admissionScopeColumn: false,
    completeRevocation: false,
    browserBootstrapClaim: false,
    completeRevocationStrict: false,
    boundAdmit: false,
    boundResolve: false,
    encryptionConfigured,
    codes,
  };
}

export async function probeBrokerCapability(): Promise<BrokerCapability> {
  const encryptionConfigured = brokerEncryptionConfigured();
  const codes: string[] = [];
  if (!encryptionConfigured) codes.push("ENCRYPTION_KEY_MISSING");
  const admin = adminOrNull();
  if (!admin) {
    codes.push("SERVICE_ROLE_MISSING");
    return failCapability(codes, encryptionConfigured);
  }
  try {
    const { data, error } = await admin.rpc("vel_broker_capability_probe" as never);
    if (error || !data || typeof data !== "object") {
      codes.push("CAPABILITY_PROBE_UNAVAILABLE");
      brokerLog("warn", "auth.broker.capability.unavailable", {
        error_code: error?.code ?? "PROBE_FAILED",
        module: "auth.broker",
      });
      return failCapability(codes, encryptionConfigured);
    }
    const row = data as Record<string, unknown>;
    const version = row.contract_version;
    if (version !== BROKER_CONTRACT_VERSION) {
      codes.push("CONTRACT_VERSION_MISMATCH");
      return failCapability(codes, encryptionConfigured);
    }
    const revokeBoolean = strictTrue(row.revoke_boolean);
    const idleWrappers = strictTrue(row.idle_wrappers);
    const brokerRegistry = strictTrue(row.broker_registry);
    const revokeAtOperation = strictTrue(row.revoke_at_operation);
    const refreshLease = strictTrue(row.refresh_lease);
    const admitOrdinal = strictTrue(row.admit_ordinal);
    const admitAtomic = strictTrue(row.admit_atomic);
    const browserAttemptIssue = row.browser_attempt_issue === true;
    const admit14arg = row.admit_14arg === true;
    const issueSeqColumn = strictTrue(row.issue_seq_column);
    const admissionScopeColumn = strictTrue(row.admission_scope_column);
    const completeRevocation = strictTrue(row.complete_revocation);
    const browserBootstrapClaim = strictTrue(row.browser_bootstrap_claim);
    const completeRevocationStrict = strictTrue(row.complete_revocation_strict);
    const boundAdmit = strictTrue(row.bound_admit);
    const boundResolve = strictTrue(row.bound_resolve);
    const probeOk = strictTrue(row.ok);
    const capability: BrokerCapability = {
      ok:
        probeOk
        && encryptionConfigured
        && revokeBoolean
        && idleWrappers
        && brokerRegistry
        && revokeAtOperation
        && refreshLease
        && admitOrdinal
        && admitAtomic
        && issueSeqColumn
        && admissionScopeColumn
        && completeRevocation
        && browserBootstrapClaim
        && completeRevocationStrict
        && boundAdmit
        && boundResolve,
      contractVersion: BROKER_CONTRACT_VERSION,
      revokeBoolean,
      idleWrappers,
      brokerRegistry,
      revokeAtOperation,
      refreshLease,
      admitOrdinal,
      admitAtomic,
      browserAttemptIssue,
      admit14arg,
      issueSeqColumn,
      admissionScopeColumn,
      completeRevocation,
      browserBootstrapClaim,
      completeRevocationStrict,
      boundAdmit,
      boundResolve,
      encryptionConfigured,
      codes: [...codes, ...((Array.isArray(row.codes) ? row.codes : []) as string[])],
    };
    if (!capability.ok) {
      brokerLog("warn", "auth.broker.capability.fail_closed", {
        error_code: "CAPABILITY_INCOMPLETE",
        codes: capability.codes,
      });
    }
    return capability;
  } catch {
    codes.push("CAPABILITY_PROBE_THROW");
    return failCapability(codes, encryptionConfigured);
  }
}

export type CommittedBrokerSession = {
  handle: string;
  cookieName: string;
  generation: string;
  boundaryFingerprint: string;
  userId: string;
  nativeSessionId: string;
  registryId: string;
  expiresAt: string;
  authOrdinal: number;
  browserLineageId: string | null;
  idempotent?: boolean;
};

/** Max active ordinal within one browser lineage — not all user devices (C3-1). */
export async function maxActiveAuthOrdinalForLineage(lineageId: string): Promise<number | null> {
  const admin = adminOrNull();
  if (!admin || !lineageId) return null;
  const { data, error } = await admin
    .from("vel_broker_sessions" as never)
    .select("auth_ordinal")
    .eq("browser_lineage_id", lineageId as never)
    .eq("status", "active" as never)
    .order("auth_ordinal", { ascending: false })
    .limit(1);
  if (error) return null;
  if (!data || !Array.isArray(data) || data.length === 0) return 0;
  const ord = Number((data[0] as { auth_ordinal: number }).auth_ordinal);
  return Number.isFinite(ord) ? ord : null;
}

/** @deprecated user-wide max — prefer maxActiveAuthOrdinalForLineage */
export async function maxActiveAuthOrdinalForUser(userId: string): Promise<number | null> {
  void userId;
  return null;
}

export async function loadRegistryByHandleHashes(hashes: string[]): Promise<RegistryRow[]> {
  const admin = adminOrNull();
  if (!admin || hashes.length === 0) return [];
  const { data, error } = await admin
    .from("vel_broker_sessions" as never)
    .select("*")
    .in("handle_hash", hashes as never);
  if (error || !data) return [];
  return data as unknown as RegistryRow[];
}

export async function findActiveByHandle(handle: string): Promise<{
  row: RegistryRow;
  accessToken: string;
  refreshToken: string;
} | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from("vel_broker_sessions" as never)
    .select("*")
    .eq("handle_hash", hashHex(handle) as never)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as RegistryRow;
  if (row.status !== "active") return null;
  const accessToken = decB64(row.access_token_enc);
  const refreshToken = decB64(row.refresh_token_enc);
  if (!accessToken || !refreshToken) return null;
  return { row, accessToken, refreshToken };
}

export async function findSessionByHandleAnyStatus(handle: string): Promise<{
  row: RegistryRow;
  accessToken: string | null;
  refreshToken: string | null;
} | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from("vel_broker_sessions" as never)
    .select("*")
    .eq("handle_hash", hashHex(handle) as never)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as RegistryRow;
  return {
    row,
    accessToken: decB64(row.access_token_enc),
    refreshToken: decB64(row.refresh_token_enc),
  };
}

/** Lease token is mandatory — no token writer may bypass refresh fencing (C2-R3). */
export async function casUpdateTokens(input: {
  registryId: string;
  expectedRevision: number;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  leaseToken: string;
}): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  if (!input.leaseToken || input.leaseToken.length < 16) return false;
  const accessEnc = encB64(input.accessToken);
  const refreshEnc = encB64(input.refreshToken);
  if (!accessEnc || !refreshEnc) return false;
  const { data, error } = await admin
    .from("vel_broker_sessions" as never)
    .update({
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      token_expires_at: input.expiresAt,
      refresh_revision: input.expectedRevision + 1,
      refresh_lease_until: null,
      refresh_lease_token: null,
      refresh_state: "idle",
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    } as never)
    .eq("id", input.registryId as never)
    .eq("refresh_revision", input.expectedRevision as never)
    .eq("refresh_lease_token", input.leaseToken as never)
    .eq("status", "active" as never)
    .select("id");
  if (error) return false;
  return Array.isArray(data) && data.length === 1;
}

export async function claimRefreshLease(
  registryId: string,
  expectedRevision: number,
  leaseMs = 15000,
): Promise<string | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin.rpc("vel_broker_claim_refresh" as never, {
    p_registry_id: registryId,
    p_expected_revision: expectedRevision,
    p_lease_ms: leaseMs,
  } as never);
  const lease: unknown = data;
  if (error || typeof lease !== "string" || lease.length < 16) return null;
  return lease;
}

export async function releaseRefreshLease(registryId: string, leaseToken: string): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const { data, error } = await admin.rpc("vel_broker_release_refresh" as never, {
    p_registry_id: registryId,
    p_lease_token: leaseToken,
  } as never);
  return !error && data === true;
}

/** After provider UNKNOWN — fence until reconcile; do not release lease for replay (C2-R3). */
export async function markRefreshUncertain(registryId: string, leaseToken: string): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const { data, error } = await admin.rpc("vel_broker_mark_refresh_uncertain" as never, {
    p_registry_id: registryId,
    p_lease_token: leaseToken,
  } as never);
  return !error && data === true;
}

export async function markSessionStatus(
  registryId: string,
  status: BrokerSessionStatus,
): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const { data, error } = await admin
    .from("vel_broker_sessions" as never)
    .update({ status, updated_at: new Date().toISOString() } as never)
    .eq("id", registryId as never)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

export type ManagedSessionRow = {
  id: string;
  nativeSessionId: string;
  accessToken: string;
  refreshToken: string;
  cookieName: string;
  status: BrokerSessionStatus;
  accessTokenEnc: string;
  refreshTokenEnc: string;
};

export type SessionInventoryResult =
  | {
      ok: true;
      sessions: ManagedSessionRow[];
      /** Frozen into the operation — pending until resolved/absent proof (C3-3). */
      legacyCoverage: "pending";
    }
  | { ok: false; code: "UNAVAILABLE" | "DECRYPT_FAILED" };

/**
 * Managed + tombstoned-without-revoke-proof. Legacy Auth natives stay pending (C3-3).
 */
export async function listActiveSessionsForUser(userId: string): Promise<SessionInventoryResult> {
  const admin = adminOrNull();
  if (!admin) return { ok: false, code: "UNAVAILABLE" };
  const { data, error } = await admin
    .from("vel_broker_sessions" as never)
    .select("*")
    .eq("user_id", userId as never)
    .in("status", ["active", "quarantined", "tombstoned"] as never);
  if (error || !data) return { ok: false, code: "UNAVAILABLE" };
  const out: ManagedSessionRow[] = [];
  for (const raw of data as unknown as RegistryRow[]) {
    // Revoked status excluded; tombstoned still need native revoke proof.
    if (raw.status === "tombstoned") {
      /* include — native may still be live */
    }
    const accessToken = decB64(raw.access_token_enc);
    const refreshToken = decB64(raw.refresh_token_enc);
    if (!accessToken || !refreshToken) {
      brokerLog("error", "auth.broker.inventory.decrypt_failed", {
        error_code: "DECRYPT_FAILED",
        user_id: userId,
      });
      return { ok: false, code: "DECRYPT_FAILED" };
    }
    out.push({
      id: raw.id,
      nativeSessionId: raw.native_session_id,
      accessToken,
      refreshToken,
      cookieName: raw.cookie_name,
      status: raw.status,
      accessTokenEnc: raw.access_token_enc,
      refreshTokenEnc: raw.refresh_token_enc,
    });
  }
  return { ok: true, sessions: out, legacyCoverage: "pending" };
}

export async function freezeLegacyCoverageOnOperation(
  operationKey: string,
  legacyCoverage: "pending" | "absent" | "resolved",
  legacyResolution?: string | null,
): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const { data, error } = await admin
    .from("vel_broker_operations" as never)
    .update({
      legacy_coverage: legacyCoverage,
      legacy_resolution: legacyResolution ?? null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("operation_key", operationKey as never)
    .is("legacy_coverage" as never, null)
    .select("id");
  if (error) return false;
  // First durable freeze write.
  if (Array.isArray(data) && data.length === 1) return true;
  // Already frozen: success without rewrite (idempotent).
  const existing = await loadBrokerOperation(operationKey);
  return Boolean(existing?.legacyCoverage);
}

export async function reserveAuthIntent(input: {
  purpose: string;
  expectedParentHandleHash?: string | null;
  userId?: string | null;
  pkceVerifier?: string | null;
  ttlSeconds?: number;
  browserLineageId?: string | null;
  recoveryOperationKey?: string | null;
}): Promise<{ id: string; stateNonce: string; ordinal: number; browserLineageId: string | null } | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const stateNonce = newOpaqueHandle();
  const pkceEnc = input.pkceVerifier ? encB64(input.pkceVerifier) : null;
  if (input.pkceVerifier && !pkceEnc) return null;
  const expiresAt = new Date(Date.now() + (input.ttlSeconds ?? 600) * 1000).toISOString();
  const { data, error } = await admin
    .from("vel_broker_auth_intents" as never)
    .insert({
      purpose: input.purpose,
      expected_parent_handle_hash: input.expectedParentHandleHash ?? null,
      user_id: input.userId ?? null,
      pkce_verifier_enc: pkceEnc,
      state_nonce: stateNonce,
      status: "reserved",
      expires_at: expiresAt,
      browser_lineage_id: input.browserLineageId ?? null,
      recovery_operation_key: input.recoveryOperationKey ?? null,
    } as never)
    .select("id,ordinal,browser_lineage_id")
    .single();
  if (error || !data) return null;
  const row = data as { id: string; ordinal: number; browser_lineage_id?: string | null };
  return {
    id: row.id,
    stateNonce,
    ordinal: row.ordinal,
    browserLineageId: row.browser_lineage_id ? String(row.browser_lineage_id) : input.browserLineageId ?? null,
  };
}

export async function loadAuthIntentByNonce(stateNonce: string): Promise<{
  id: string;
  ordinal: number;
  purpose: string;
  status: string;
  expiresAt: string;
  pkceVerifier: string | null;
  userId: string | null;
  expectedParentHandleHash: string | null;
  browserLineageId: string | null;
  recoveryOperationKey: string | null;
  admissionReceipt: Record<string, unknown> | null;
} | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from("vel_broker_auth_intents" as never)
    .select("*")
    .eq("state_nonce", stateNonce as never)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const receipt =
    row.admission_receipt && typeof row.admission_receipt === "object" && !Array.isArray(row.admission_receipt)
      ? (row.admission_receipt as Record<string, unknown>)
      : null;
  return {
    id: String(row.id),
    ordinal: Number(row.ordinal),
    purpose: String(row.purpose),
    status: String(row.status),
    expiresAt: String(row.expires_at),
    pkceVerifier: typeof row.pkce_verifier_enc === "string" ? decB64(row.pkce_verifier_enc) : null,
    userId: row.user_id ? String(row.user_id) : null,
    expectedParentHandleHash: row.expected_parent_handle_hash
      ? String(row.expected_parent_handle_hash)
      : null,
    browserLineageId: row.browser_lineage_id ? String(row.browser_lineage_id) : null,
    recoveryOperationKey: row.recovery_operation_key ? String(row.recovery_operation_key) : null,
    admissionReceipt: receipt,
  };
}

/**
 * Validate committed intent via same bound resolve authority path (R4-F06).
 * bootstrapHash required — never assemble from max(active).
 */
export async function materializeCommittedIntentAdmission(
  intent: NonNullable<Awaited<ReturnType<typeof loadAuthIntentByNonce>>>,
  bootstrapHash: string,
): Promise<CommittedBrokerSession | null> {
  if (intent.status !== "committed" || !intent.admissionReceipt || intent.admissionReceipt.ok !== true) {
    return null;
  }
  // Receipt replay is bounded by the intent TTL; established sessions resolve separately.
  const intentExpiry = Date.parse(intent.expiresAt);
  if (!Number.isFinite(intentExpiry) || intentExpiry <= Date.now()) return null;
  const receipt = intent.admissionReceipt;
  if (receipt.handle_token != null) return null;
  const enc = receipt.handle_token_enc;
  if (typeof enc !== "string") return null;
  if (receipt.admission_scope === "recovery") return null;
  const handleHashHex = typeof receipt.handle_hash === "string" ? receipt.handle_hash : null;
  const userId = typeof receipt.user_id === "string" ? receipt.user_id : intent.userId;
  const nativeSessionId =
    typeof receipt.native_session_id === "string" ? receipt.native_session_id : null;
  const browserLineageId =
    typeof receipt.browser_lineage_id === "string" ? receipt.browser_lineage_id : intent.browserLineageId;
  if (!handleHashHex || !userId || !nativeSessionId || !browserLineageId || !bootstrapHash) return null;

  const row = await resolveBoundSession({
    bootstrapHash,
    handleHashes: [handleHashHex],
    admissionScope: "app",
  });
  if (!row) return null;
  if (row.handle_hash !== handleHashHex) return null;
  if (row.user_id !== userId || row.native_session_id !== nativeSessionId) return null;
  if (row.browser_lineage_id !== browserLineageId) return null;
  if (typeof receipt.registry_id === "string" && row.registry_id !== receipt.registry_id) return null;
  if (typeof receipt.cookie_name === "string" && row.cookie_name !== receipt.cookie_name) return null;

  const handle = decryptAdmissionHandle(enc, {
    intentId: intent.id,
    userId,
    nativeSessionId,
    lineageId: browserLineageId,
    handleHashHex,
  });
  if (!handle || !receiptHandleMatchesHash(handle, handleHashHex)) return null;

  return {
    handle,
    cookieName: row.cookie_name,
    generation: row.generation,
    boundaryFingerprint: boundaryFingerprint(handle),
    userId,
    nativeSessionId,
    registryId: row.registry_id,
    expiresAt: row.token_expires_at,
    authOrdinal: Number(row.auth_ordinal ?? 0),
    browserLineageId,
    idempotent: true,
  };
}

/** Deprecated side channel — always fail closed (R4-F07). */
export async function commitAuthIntentOrdinal(
  _intentId: string,
  _nativeSessionId: string,
  _userId: string,
): Promise<number | null> {
  void _intentId;
  void _nativeSessionId;
  void _userId;
  brokerLog("error", "auth.broker.registry.commit_intent_ordinal_denied", {
    error_code: "DEPRECATED_USE_BOUND_ADMIT",
  });
  return null;
}

/** Same DB sequence as auth_intents.ordinal — never application clock/random (C2-R1). */
export async function allocateStandaloneOrdinal(): Promise<number | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin.rpc("vel_broker_next_auth_ordinal" as never);
  if (error || data == null) return null;
  const ord = Number(data);
  return Number.isFinite(ord) ? ord : null;
}

export async function updateOperationTargetReceipts(
  operationKey: string,
  receipts: Record<string, unknown>,
): Promise<boolean> {
  // Merge ONE registry UUID at a time via RPC — avoid whole-map lost updates (C5-R4).
  let wroteUuid = false;
  for (const [registryId, outcome] of Object.entries(receipts)) {
    if (typeof outcome !== "string" || !/^[0-9a-f-]{36}$/i.test(registryId)) continue;
    const ok = await recordTargetOutcome(operationKey, registryId, outcome);
    if (!ok) return false;
    wroteUuid = true;
  }
  const nonUuid = Object.entries(receipts).filter(
    ([id, outcome]) => typeof outcome === "string" && !/^[0-9a-f-]{36}$/i.test(id),
  );
  if (nonUuid.length === 0) return wroteUuid || Object.keys(receipts).length === 0;
  // Logout non-registry keys only — never touch confirmed rows.
  const admin = adminOrNull();
  if (!admin) return false;
  const existing = await loadBrokerOperation(operationKey);
  if (!existing) return false;
  if (existing.status === "confirmed") return true;
  const merged = { ...existing.targetReceipts };
  for (const [k, v] of nonUuid) merged[k] = String(v);
  const { data, error } = await admin
    .from("vel_broker_operations" as never)
    .update({ target_receipts: merged, updated_at: new Date().toISOString() } as never)
    .eq("operation_key", operationKey as never)
    .neq("status", "confirmed" as never)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

export async function createBrokerOperation(input: {
  operationKey: string;
  kind: "logout" | "password_revoke";
  actorUserId: string;
  targetNativeSessionId?: string | null;
  targetSnapshot?: unknown[];
}): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const { data, error } = await admin
    .from("vel_broker_operations" as never)
    .insert({
      operation_key: input.operationKey,
      kind: input.kind,
      actor_user_id: input.actorUserId,
      target_native_session_id: input.targetNativeSessionId ?? null,
      target_snapshot: input.targetSnapshot ?? [],
      stages: {},
      status: "open",
    } as never)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

export async function freezeOperationSnapshot(
  operationKey: string,
  actorUserId: string,
  snapshot: unknown[],
): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const { data, error } = await admin.rpc("vel_broker_freeze_operation_snapshot" as never, {
    p_operation_key: operationKey,
    p_actor_user_id: actorUserId,
    p_snapshot: snapshot,
  } as never);
  return !error && data === true;
}

export async function loadBrokerOperation(operationKey: string): Promise<{
  operationKey: string;
  kind: string;
  actorUserId: string;
  cutoff: string | null;
  targetNativeSessionId: string | null;
  targetSnapshot: unknown[];
  targetReceipts: Record<string, string>;
  stages: Record<string, unknown>;
  status: string;
  credentialMutatedAt: string | null;
  snapshotFrozen: boolean;
  legacyCoverage: "pending" | "absent" | "resolved" | null;
  legacyResolution: string | null;
  revision: number;
} | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from("vel_broker_operations" as never)
    .select("*")
    .eq("operation_key", operationKey as never)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const receipts =
    row.target_receipts && typeof row.target_receipts === "object" && !Array.isArray(row.target_receipts)
      ? (row.target_receipts as Record<string, string>)
      : {};
  const lc = row.legacy_coverage;
  return {
    operationKey: String(row.operation_key),
    kind: String(row.kind),
    actorUserId: String(row.actor_user_id),
    cutoff: row.cutoff ? String(row.cutoff) : null,
    targetNativeSessionId: row.target_native_session_id ? String(row.target_native_session_id) : null,
    targetSnapshot: Array.isArray(row.target_snapshot) ? row.target_snapshot : [],
    targetReceipts: receipts,
    stages: (row.stages && typeof row.stages === "object" ? row.stages : {}) as Record<string, unknown>,
    status: String(row.status),
    credentialMutatedAt: row.credential_mutated_at ? String(row.credential_mutated_at) : null,
    snapshotFrozen: row.snapshot_frozen === true,
    legacyCoverage:
      lc === "pending" || lc === "absent" || lc === "resolved" ? lc : null,
    legacyResolution: row.legacy_resolution ? String(row.legacy_resolution) : null,
    revision: Number(row.revision ?? 0),
  };
}

/** Completeness gate shared by password execute/resume/ack (C3-3). */
export function operationRevocationComplete(op: {
  legacyCoverage: "pending" | "absent" | "resolved" | null;
  targetSnapshot: unknown[];
  targetReceipts: Record<string, string>;
}): boolean {
  if (op.legacyCoverage === "pending" || op.legacyCoverage == null) return false;
  if (op.legacyCoverage !== "absent" && op.legacyCoverage !== "resolved") return false;
  const frozen = op.targetSnapshot as Array<{ registryId?: string }>;
  if (!Array.isArray(frozen) || frozen.length === 0) return false;
  for (const t of frozen) {
    if (!t.registryId) return false;
    if (op.targetReceipts[t.registryId] !== "native_confirmed") return false;
  }
  return true;
}

export async function updateBrokerOperation(
  operationKey: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const existing = await loadBrokerOperation(operationKey);
  if (!existing) return false;
  if (existing.status === "confirmed") {
    // Terminal operations permit only a durable monotonic client-cleanup acknowledgment.
    const stages = patch.stages;
    if (!stages || typeof stages !== "object" || Array.isArray(stages)
      || Object.keys(patch).some(key => key !== "stages" && key !== "status")
      || (patch.status !== undefined && patch.status !== "confirmed")) return false;
    const next = stages as Record<string, unknown>;
    if (next.clientCleanup !== "confirmed") return false;
    const keys = new Set([...Object.keys(existing.stages), ...Object.keys(next)]);
    if ([...keys].some(key => key !== "clientCleanup" && next[key] !== existing.stages[key])) return false;
    const { data, error } = await admin.rpc("vel_broker_patch_operation" as never, {
      p_operation_key: operationKey, p_expected_revision: existing.revision, p_patch: patch,
    } as never);
    return !error && !!data && typeof data === "object" && (data as {ok?:boolean}).ok === true;
  }
  // password_revoke terminal confirm is completeRevocationOperation only (C5-R4).
  if (patch.status === "confirmed" && existing.kind === "password_revoke") {
    return false;
  }
  // Logout may still confirm via guarded direct update (not password complete RPC).
  if (patch.status === "confirmed" && existing.kind === "logout") {
    const { data, error } = await admin
      .from("vel_broker_operations" as never)
      .update({ ...patch, updated_at: new Date().toISOString() } as never)
      .eq("operation_key", operationKey as never)
      .neq("status", "confirmed" as never)
      .select("id");
    return !error && Array.isArray(data) && data.length === 1;
  }
  const { data, error } = await admin.rpc("vel_broker_patch_operation" as never, {
    p_operation_key: operationKey,
    p_expected_revision: existing.revision,
    p_patch: patch,
  } as never);
  if (error || !data || typeof data !== "object") return false;
  const row = data as { ok?: boolean; idempotent?: boolean };
  return row.ok === true;
}

export async function setAdmissionBarrier(
  userId: string,
  operationKey: string,
  active: boolean,
  expectedTip?: { handleHash: string; browserLineageId: string } | null,
): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const { data, error } = await admin.rpc("vel_broker_set_admission_barrier" as never, {
    p_user_id: userId,
    p_operation_key: operationKey,
    p_active: active,
    p_expected_tip_handle_hash: expectedTip?.handleHash ?? null,
    p_browser_lineage_id: expectedTip?.browserLineageId ?? null,
  } as never);
  return !error && data === true;
}

/** Confirm password_revoke + release barrier atomically (C5-R4 strict). */
export async function completeRevocationOperation(
  userId: string,
  operationKey: string,
): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const { data, error } = await admin.rpc("vel_broker_complete_revocation_operation" as never, {
    p_user_id: userId,
    p_operation_key: operationKey,
  } as never);
  // R4-F01: complete returns boolean only.
  return !error && data === true;
}

export async function recordTargetOutcome(
  operationKey: string,
  registryId: string,
  outcome: string,
): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const { data, error } = await admin.rpc("vel_broker_record_target_outcome" as never, {
    p_operation_key: operationKey,
    p_registry_id: registryId,
    p_outcome: outcome,
  } as never);
  return !error && data === true;
}

export async function reserveBoundAuthIntent(input: {
  bootstrapHash: string;
  requestNonce: string;
  purpose: string;
  recoveryOperationKey?: string | null;
  ttlSeconds?: number;
}): Promise<{
  id: string;
  stateNonce: string;
  lineageGeneration: number;
  browserLineageId: string;
  parentHandleHash: string | null;
  providerState: string;
} | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin.rpc("vel_broker_reserve_bound_intent" as never, {
    p_bootstrap_hash: input.bootstrapHash,
    p_request_nonce: input.requestNonce,
    p_purpose: input.purpose,
    p_recovery_operation_key: input.recoveryOperationKey ?? null,
    p_ttl_seconds: input.ttlSeconds ?? 600,
  } as never);
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.ok !== true) return null;
  return {
    id: String(row.intent_id),
    stateNonce: String(row.state_nonce),
    lineageGeneration: Number(row.lineage_generation),
    browserLineageId: String(row.browser_lineage_id),
    parentHandleHash: typeof row.parent_handle_hash === "string" ? row.parent_handle_hash : null,
    providerState: String(row.provider_state ?? "ready"),
  };
}

export async function claimProviderAttempt(intentId: string): Promise<{
  ok: boolean;
  claimed: boolean;
  providerState?: string;
}> {
  const admin = adminOrNull();
  if (!admin) return { ok: false, claimed: false };
  const { data, error } = await admin.rpc("vel_broker_claim_provider_attempt" as never, {
    p_intent_id: intentId,
  } as never);
  if (error || !data || typeof data !== "object") return { ok: false, claimed: false };
  const row = data as Record<string, unknown>;
  return {
    ok: row.ok === true,
    claimed: row.claimed === true,
    providerState: typeof row.provider_state === "string" ? row.provider_state : undefined,
  };
}

export async function recordProviderSessionCapture(input: {
  intentId: string;
  userId: string;
  nativeSessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const accessEnc = encB64(input.accessToken);
  const refreshEnc = encB64(input.refreshToken);
  if (!accessEnc || !refreshEnc) return false;
  const { data, error } = await admin.rpc("vel_broker_record_provider_session" as never, {
    p_intent_id: input.intentId,
    p_user_id: input.userId,
    p_native_session_id: input.nativeSessionId,
    p_access_token_enc: accessEnc,
    p_refresh_token_enc: refreshEnc,
    p_token_expires_at: input.expiresAt,
  } as never);
  return !error && data === true;
}

export async function admitBoundSessionAtomic(input: {
  intentId: string;
  userId: string;
  nativeSessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  admissionScope?: "app" | "recovery";
  recoveryOperationKey?: string | null;
  browserLineageId: string;
}): Promise<CommittedBrokerSession | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const accessEnc = encB64(input.accessToken);
  const refreshEnc = encB64(input.refreshToken);
  if (!accessEnc || !refreshEnc) return null;
  const handle = newOpaqueHandle();
  const handleHashHex = hashHex(handle);
  const handleEnc = encryptAdmissionHandle(handle, {
    intentId: input.intentId,
    userId: input.userId,
    nativeSessionId: input.nativeSessionId,
    lineageId: input.browserLineageId,
    handleHashHex,
  });
  if (!handleEnc) return null;
  const generation = newGenerationId();
  const cookieName = `${BROKER_COOKIE_PREFIX}${generation}`;
  const { data, error } = await admin.rpc("vel_broker_admit_bound_session" as never, {
    p_intent_id: input.intentId,
    p_user_id: input.userId,
    p_native_session_id: input.nativeSessionId,
    p_handle_hash: handleHashHex,
    p_cookie_name: cookieName,
    p_generation: generation,
    p_access_token_enc: accessEnc,
    p_refresh_token_enc: refreshEnc,
    p_token_expires_at: input.expiresAt,
    p_admission_scope: input.admissionScope ?? "app",
    p_recovery_operation_key: input.recoveryOperationKey ?? null,
    p_handle_token_enc: handleEnc,
  } as never);
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.ok !== true) return null;
  if (row.idempotent === true) {
    const receiptHash =
      typeof row.handle_hash === "string" ? row.handle_hash : handleHashHex;
    const enc =
      typeof row.handle_token_enc === "string" ? row.handle_token_enc : null;
    if (!enc) return null;
    const lineageId =
      typeof row.browser_lineage_id === "string" ? row.browser_lineage_id : input.browserLineageId;
    const receiptHandle = decryptAdmissionHandle(enc, {
      intentId: input.intentId,
      userId: input.userId,
      nativeSessionId: input.nativeSessionId,
      lineageId,
      handleHashHex: receiptHash,
    });
    if (!receiptHandle || !receiptHandleMatchesHash(receiptHandle, receiptHash)) return null;
    const registryId = typeof row.registry_id === "string" ? row.registry_id : null;
    if (!registryId) return null;
    return {
      handle: receiptHandle,
      cookieName: typeof row.cookie_name === "string" ? row.cookie_name : cookieName,
      generation: typeof row.generation === "string" ? row.generation : generation,
      boundaryFingerprint: boundaryFingerprint(receiptHandle),
      userId: input.userId,
      nativeSessionId: input.nativeSessionId,
      registryId,
      expiresAt: input.expiresAt,
      authOrdinal: Number(row.lineage_generation ?? 0),
      browserLineageId: lineageId,
      idempotent: true,
    };
  }
  const registryId = typeof row.registry_id === "string" ? row.registry_id : null;
  if (!registryId) return null;
  return {
    handle,
    cookieName: typeof row.cookie_name === "string" ? row.cookie_name : cookieName,
    generation: typeof row.generation === "string" ? row.generation : generation,
    boundaryFingerprint: boundaryFingerprint(handle),
    userId: input.userId,
    nativeSessionId: input.nativeSessionId,
    registryId,
    expiresAt: input.expiresAt,
    authOrdinal: Number(row.lineage_generation ?? 0),
    browserLineageId: typeof row.browser_lineage_id === "string" ? row.browser_lineage_id : input.browserLineageId,
  };
}

export async function resolveBoundSession(input: {
  bootstrapHash: string;
  handleHashes: string[];
  admissionScope?: "app" | "recovery";
}): Promise<{
  registry_id: string;
  handle_hash: string;
  cookie_name: string;
  generation: string;
  user_id: string;
  native_session_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: string;
  refresh_revision: number;
  auth_ordinal: number;
  browser_lineage_id: string;
  lineage_generation: number;
} | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin.rpc("vel_broker_resolve_bound_session" as never, {
    p_bootstrap_hash: input.bootstrapHash,
    p_handle_hashes: input.handleHashes,
    p_admission_scope: input.admissionScope ?? "app",
  } as never);
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.ok !== true) return null;
  if (typeof row.registry_id !== "string" || typeof row.handle_hash !== "string") return null;
  return {
    registry_id: row.registry_id,
    handle_hash: row.handle_hash,
    cookie_name: String(row.cookie_name),
    generation: String(row.generation),
    user_id: String(row.user_id),
    native_session_id: String(row.native_session_id),
    access_token_enc: String(row.access_token_enc),
    refresh_token_enc: String(row.refresh_token_enc),
    token_expires_at: String(row.token_expires_at),
    refresh_revision: Number(row.refresh_revision ?? 0),
    auth_ordinal: Number(row.auth_ordinal ?? 0),
    browser_lineage_id: String(row.browser_lineage_id),
    lineage_generation: Number(row.lineage_generation ?? 0),
  };
}

export async function admissionAllows(userId: string): Promise<boolean> {
  const admin = adminOrNull();
  if (!admin) return false;
  const { data, error } = await admin.rpc("vel_broker_admission_allows" as never, {
    p_user_id: userId,
  } as never);
  if (error) return false;
  return data === true;
}

export async function readOperationStatusRpc(operationKey: string): Promise<Record<string, unknown> | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin.rpc("vel_broker_operation_status" as never, {
    p_operation_key: operationKey,
  } as never);
  if (error || !data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

/** Native absence is proved by SQL against frozen actor/cutoff/epoch, never inferred from an Auth error. */
export async function reconcileNativeRevocation(userId:string,operationKey:string) {
 const admin=adminOrNull();if(!admin)return null;
 const {data,error}=await admin.rpc("vel_broker_confirm_native_absence" as never,{p_user_id:userId,p_operation_key:operationKey} as never);
 if(error||data!==true)return null;
 const op=await loadBrokerOperation(operationKey);
 return op?.actorUserId===userId && op.operationKey===operationKey && op.snapshotFrozen && op.legacyResolution==="native_absence_with_epoch_v1" && operationRevocationComplete(op)?op:null;
}

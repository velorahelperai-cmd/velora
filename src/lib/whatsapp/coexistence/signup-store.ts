import "server-only";
import { prepareCoexistenceSignup, subscribeAndVerifyCoexistence, type CoexistenceProviderConfig } from "./provider";
import type { CoexistenceSignupIdentity, CoexistenceSignupCompletionInput, CoexistenceSignupClaim, CoexistenceSignupFailure, CoexistenceSignupFailureCode, CoexistenceSignupPorts } from "./flow";

export type CoexistenceSignupRpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
const object = (x: unknown): Record<string, unknown> | null => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null;
const uuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const phone = (x: unknown): x is string => typeof x === "string" && /^\+[1-9][0-9]{6,14}$/.test(x);
const timestamp = (x: unknown): x is string => typeof x === "string" && x.length <= 40 && Number.isFinite(Date.parse(x));
const codes = new Set<CoexistenceSignupFailureCode>(["NEEDS_SETUP", "INVALID_INPUT", "META_AUTHORIZATION_REJECTED", "META_ASSET_REJECTED", "META_UNAVAILABLE", "RECONCILIATION_REQUIRED", "FORBIDDEN", "EXPIRED", "CONSUMED", "UNAVAILABLE"]);
const fail = (code: CoexistenceSignupFailureCode = "UNAVAILABLE"): CoexistenceSignupFailure => ({ ok: false, code });
type SuccessfulRpcRow = { ok: true; [key: string]: unknown };
async function rpc(client: CoexistenceSignupRpcClient, name: string, args: Record<string, unknown>): Promise<SuccessfulRpcRow | CoexistenceSignupFailure> {
  try {
    const result = await client.rpc(name, args), row = object(result.data);
    if (result.error || !row) return fail();
    if (row.ok !== true) return fail(row.ok === false && codes.has(row.code as CoexistenceSignupFailureCode) ? row.code as CoexistenceSignupFailureCode : "UNAVAILABLE");
    return { ...row, ok: true };
  } catch { return fail(); }
}
const sameUuid = (raw: unknown, expected: string) => uuid(raw) && raw.toLowerCase() === expected.toLowerCase();
function bound(row: Record<string, unknown>, identity: CoexistenceSignupIdentity, attemptId: string) {
  return sameUuid(row.attempt_id, attemptId) && sameUuid(row.company_id, identity.companyId)
    && sameUuid(row.user_id, identity.userId) && sameUuid(row.session_id, identity.sessionId);
}

/** A generic legacy signup readiness result cannot attest that this package exists. */
export async function readCoexistenceSignupReadiness(client: CoexistenceSignupRpcClient, companyId: string) {
  if (!uuid(companyId)) return fail("INVALID_INPUT");
  const r = await rpc(client, "whatsapp_coexistence_signup_readiness", { p_company_id: companyId.toLowerCase() });
  if (r.ok !== true) return fail(r.code as CoexistenceSignupFailureCode);
  if (r.version !== "coexistence_signup_v1" || r.connection_mode_contract !== "coexistence_binding_v1"
    || !sameUuid(r.company_id, companyId) || r.history_enabled !== false || r.ai_enabled !== false) return fail("NEEDS_SETUP");
  return { ok: true as const, installed: true as const, historyEnabled: false as const, aiEnabled: false as const };
}
export type CoexistenceSignupStart = { companyId: string; attemptId: string; nonce: string; expectedPhoneNumber: string; appId: string; configId: string; graphVersion: string; keepOnPhone: true };
export async function startCoexistenceSignupStore(client: CoexistenceSignupRpcClient, input: CoexistenceSignupStart) {
  if (!input || !uuid(input.companyId) || !uuid(input.attemptId) || !/^[0-9a-f]{64}$/.test(input.nonce)
    || !phone(input.expectedPhoneNumber) || !/^[0-9]{1,64}$/.test(input.appId) || !/^[0-9]{1,64}$/.test(input.configId)
    || !/^v[0-9]+\.0$/.test(input.graphVersion) || input.keepOnPhone !== true) return fail("INVALID_INPUT");
  const r = await rpc(client, "whatsapp_coexistence_start_signup", {
    p_company_id: input.companyId.toLowerCase(), p_attempt_id: input.attemptId.toLowerCase(), p_nonce: input.nonce,
    p_expected_phone_number: input.expectedPhoneNumber, p_app_id: input.appId, p_config_id: input.configId,
    p_graph_version: input.graphVersion, p_keep_on_phone: true,
  });
  if (r.ok !== true) return fail(r.code as CoexistenceSignupFailureCode);
  if (!sameUuid(r.company_id, input.companyId) || !sameUuid(r.attempt_id, input.attemptId) || r.nonce !== input.nonce
    || r.expected_phone_number !== input.expectedPhoneNumber || !timestamp(r.expires_at)) return fail();
  return { ok: true as const, attemptId: String(r.attempt_id), nonce: input.nonce, expiresAt: r.expires_at };
}

export function createCoexistenceSignupPorts(identity: CoexistenceSignupIdentity, input: CoexistenceSignupCompletionInput,
  config: CoexistenceProviderConfig & { configId: string }, session: CoexistenceSignupRpcClient, admin: CoexistenceSignupRpcClient): CoexistenceSignupPorts {
  const binding = { p_attempt_id: input.attemptId.toLowerCase(), p_user_id: identity.userId.toLowerCase(), p_session_id: identity.sessionId.toLowerCase() };
  return {
    claim: async () => {
      const r = await rpc(session, "whatsapp_coexistence_claim_signup", { p_company_id: identity.companyId.toLowerCase(), p_attempt_id: input.attemptId.toLowerCase(), p_nonce: input.nonce });
      if (r.ok !== true) return fail(r.code as CoexistenceSignupFailureCode);
      if (!bound(r, identity, input.attemptId) || r.app_id !== config.appId || r.config_id !== config.configId
        || r.graph_version !== config.graphVersion || r.keep_on_phone !== true || !phone(r.expected_phone_number)) return fail();
      return { ok: true, attempt_id: String(r.attempt_id), company_id: String(r.company_id), user_id: String(r.user_id), session_id: String(r.session_id),
        app_id: config.appId, config_id: config.configId, graph_version: config.graphVersion, keep_on_phone: true, expected_phone_number: r.expected_phone_number } as CoexistenceSignupClaim;
    },
    prepare: providerInput => prepareCoexistenceSignup(config, providerInput),
    checkpoint: async (claim, token, proof) => {
      if (!bound(claim, identity, input.attemptId) || claim.keep_on_phone !== true || typeof token !== "string" || !token.trim() || token.length > 16384 || proof.subscribed !== false) return fail("INVALID_INPUT");
      const r = await rpc(admin, "whatsapp_coexistence_checkpoint_signup", { ...binding, p_access_token: token, p_proof: proof });
      if (r.ok !== true) return fail(r.code as CoexistenceSignupFailureCode);
      return bound(r, identity, input.attemptId) && r.status === "token_checkpointed" && r.token_checkpointed === true ? { ok: true } : fail();
    },
    subscribe: prepared => subscribeAndVerifyCoexistence(config, prepared),
    finalize: async (claim, proof) => {
      if (!bound(claim, identity, input.attemptId) || claim.keep_on_phone !== true || proof.subscribed !== true) return fail("INVALID_INPUT");
      const r = await rpc(admin, "whatsapp_coexistence_finalize_signup", { ...binding, p_proof: proof });
      if (r.ok !== true) return fail(r.code as CoexistenceSignupFailureCode);
      return bound(r, identity, input.attemptId) && r.status === "completed" && r.history_enabled === false && r.ai_enabled === false ? { ok: true } : fail();
    },
    fail: async code => { await rpc(admin, "whatsapp_coexistence_fail_signup", { ...binding, p_code: codes.has(code) ? code : "RECONCILIATION_REQUIRED" }); },
  };
}

export async function readCoexistenceSignupStatus(client: CoexistenceSignupRpcClient, companyId: string) {
  if (!uuid(companyId)) return fail("INVALID_INPUT");
  const r = await rpc(client, "whatsapp_coexistence_read_signup_status", { p_company_id: companyId.toLowerCase() });
  if (r.ok !== true) return fail(r.code as CoexistenceSignupFailureCode);
  if (!sameUuid(r.company_id, companyId) || !["no_attempt", "started", "claimed", "token_checkpointed", "reconcile_required", "completed", "cancelled"].includes(String(r.status))
    || !["not_connected", "active", "disconnected", "expired", "revoked", "needs_reauth"].includes(String(r.connection_status))
    || (r.attempt_id !== null && !uuid(r.attempt_id)) || (r.expected_phone_number !== null && !phone(r.expected_phone_number))
    || (r.expires_at !== null && !timestamp(r.expires_at)) || (r.link_id !== null && !uuid(r.link_id))
    || ((r.link_id === null) !== (r.link_generation === null))
    || (r.link_generation !== null && (!Number.isSafeInteger(r.link_generation) || Number(r.link_generation) < 1))
    || (r.display_phone_number !== null && (typeof r.display_phone_number !== "string" || r.display_phone_number.length > 40 || !/^[+0-9() -]+$/.test(r.display_phone_number)))
    || typeof r.live_verified !== "boolean" || (r.connection_status !== "active" && (r.live_verified || r.display_phone_number !== null))
    || (r.connection_status === "active" && (r.link_id === null || r.display_phone_number === null))
    || !["not_requested", "pending", "syncing", "completed", "failed", "reconcile_required"].includes(String(r.history_sync_status))
    || r.history_status !== "disabled" || r.ai_enabled !== false
    || (r.last_error_code !== null && !codes.has(r.last_error_code as CoexistenceSignupFailureCode))) return fail();
  return { ok: true as const, companyId: String(r.company_id), attemptId: r.attempt_id as string | null, status: String(r.status),
    expectedPhoneNumber: r.expected_phone_number as string | null, expiresAt: r.expires_at as string | null,
    connectionStatus: String(r.connection_status), linkId: r.link_id as string | null, linkGeneration: r.link_generation as number | null,
    displayPhoneNumber: r.display_phone_number as string | null, liveVerified: r.live_verified as boolean, historySyncStatus: r.history_sync_status as "not_requested" | "pending" | "syncing" | "completed" | "failed" | "reconcile_required",
    historyStatus: "disabled" as const, aiEnabled: false as const, lastErrorCode: r.last_error_code as CoexistenceSignupFailureCode | null };
}
export async function cancelCoexistenceSignupStore(client: CoexistenceSignupRpcClient, companyId: string, attemptId: string, nonce: string) {
  if (!uuid(companyId) || !uuid(attemptId) || !/^[0-9a-f]{64}$/.test(nonce)) return fail("INVALID_INPUT");
  const r = await rpc(client, "whatsapp_coexistence_cancel_signup", { p_company_id: companyId.toLowerCase(), p_attempt_id: attemptId.toLowerCase(), p_nonce: nonce });
  if (r.ok !== true) return fail(r.code as CoexistenceSignupFailureCode);
  return sameUuid(r.company_id, companyId) && sameUuid(r.attempt_id, attemptId) && r.cancelled === true ? { ok: true as const } : fail();
}
export async function disconnectCoexistenceSignupStore(client: CoexistenceSignupRpcClient, companyId: string) {
  if (!uuid(companyId)) return fail("INVALID_INPUT");
  const r = await rpc(client, "whatsapp_coexistence_disconnect", { p_company_id: companyId.toLowerCase() });
  if (r.ok !== true) return fail(r.code as CoexistenceSignupFailureCode);
  return sameUuid(r.company_id, companyId) && r.disconnected === true && r.history_enabled === false && r.ai_enabled === false ? { ok: true as const } : fail();
}

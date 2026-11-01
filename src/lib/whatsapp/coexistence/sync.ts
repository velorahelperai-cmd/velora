import "server-only";

export type CoexistenceSyncType = "history" | "smb_app_state_sync";
export type CoexistenceSyncState = "not_requested" | "pending" | "syncing" | "completed" | "failed" | "reconcile_required";
export type CoexistenceSyncIdentity = { companyId: string; userId: string; sessionId: string };
export type CoexistenceSyncInput = { requestId: string; linkId: string; linkGeneration: number; syncType: CoexistenceSyncType; consent: true };
export type CoexistenceSyncConfig = { enabled: boolean; appId: string; graphVersion: string };
export type CoexistenceSyncFailureCode = "NEEDS_SETUP" | "INVALID_INPUT" | "FORBIDDEN" | "EXPIRED" | "CONSUMED" | "CONNECTION_UNAVAILABLE" | "UNAVAILABLE" | "RECONCILIATION_REQUIRED";
export type CoexistenceSyncFailure = { ok: false; code: CoexistenceSyncFailureCode };
export type CoexistenceSyncClaim = CoexistenceSyncIdentity & {
  ok: true; requestId: string; linkId: string; linkGeneration: number; syncType: CoexistenceSyncType;
  appId: string; graphVersion: string; stage: "claimed"; onboardedAt: string; deadlineAt: string;
};
/** Credential data returned only by the service RPC after its one-use executing transition. */
export type CoexistenceSyncAuthorization = Omit<CoexistenceSyncClaim, "stage"> & {
  stage: "executing"; accessToken: string; phoneNumberId: string;
  authorizationExpiresAt: string | null; authorizationNonExpiring: boolean;
};
export type CoexistenceSyncProviderResult = { ok: true; requestId: string } | CoexistenceSyncFailure;
export type CoexistenceSyncPorts = {
  claim: () => Promise<CoexistenceSyncClaim | CoexistenceSyncFailure>;
  authorize: (claim: CoexistenceSyncClaim) => Promise<{ ok: true; authorization: CoexistenceSyncAuthorization } | CoexistenceSyncFailure>;
  provider: (authorization: CoexistenceSyncAuthorization) => Promise<CoexistenceSyncProviderResult>;
  finalize: (claim: CoexistenceSyncClaim, providerRequestId: string) => Promise<{ ok: true } | CoexistenceSyncFailure>;
  fail: () => Promise<void>;
};
export type CoexistenceSyncRpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export type CoexistenceSyncFetch = (url: string, init?: RequestInit) => Promise<Response>;
const types: readonly CoexistenceSyncType[] = ["history", "smb_app_state_sync"];
const states: readonly CoexistenceSyncState[] = ["not_requested", "pending", "syncing", "completed", "failed", "reconcile_required"];
const codes = new Set<CoexistenceSyncFailureCode>(["NEEDS_SETUP", "INVALID_INPUT", "FORBIDDEN", "EXPIRED", "CONSUMED", "CONNECTION_UNAVAILABLE", "UNAVAILABLE", "RECONCILIATION_REQUIRED"]);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const providerId = (value: unknown): value is string => typeof value === "string" && /^[^\s\u0000-\u001f\u007f]{1,512}$/.test(value);
const generation = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const timestamp = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const fail = (code: CoexistenceSyncFailureCode = "UNAVAILABLE"): CoexistenceSyncFailure => ({ ok: false, code });
const sameUuid = (raw: unknown, expected: string) => uuid(raw) && raw.toLowerCase() === expected.toLowerCase();
const validConfig = (config: CoexistenceSyncConfig) => /^[1-9]\d{0,31}$/.test(config.appId) && /^v\d+\.0$/.test(config.graphVersion);
function windowValid(claim: { onboardedAt: string; deadlineAt: string }, now: number) {
  if (!Number.isSafeInteger(now) || !timestamp(claim.onboardedAt) || !timestamp(claim.deadlineAt)) return false;
  const onboarded = Date.parse(claim.onboardedAt), deadline = Date.parse(claim.deadlineAt);
  return onboarded <= now && deadline > now && deadline <= onboarded + 86_400_000 && deadline > onboarded;
}
function bound(claim: CoexistenceSyncClaim | CoexistenceSyncAuthorization, identity: CoexistenceSyncIdentity, input: CoexistenceSyncInput, config: CoexistenceSyncConfig) {
  return sameUuid(claim.companyId, identity.companyId) && sameUuid(claim.userId, identity.userId) && sameUuid(claim.sessionId, identity.sessionId)
    && sameUuid(claim.requestId, input.requestId) && sameUuid(claim.linkId, input.linkId) && claim.linkGeneration === input.linkGeneration
    && claim.syncType === input.syncType && claim.appId === config.appId && claim.graphVersion === config.graphVersion;
}
function credentialValid(auth: CoexistenceSyncAuthorization, config: CoexistenceSyncConfig, now: number) {
  return auth.stage === "executing" && auth.appId === config.appId && auth.graphVersion === config.graphVersion && types.includes(auth.syncType)
    && typeof auth.accessToken === "string" && !!auth.accessToken.trim() && auth.accessToken.length <= 16384 && /^[1-9]\d{0,31}$/.test(auth.phoneNumberId)
    && windowValid(auth, now) && (auth.authorizationExpiresAt === null ? auth.authorizationNonExpiring === true : timestamp(auth.authorizationExpiresAt) && Date.parse(auth.authorizationExpiresAt) > now);
}

/** Explicit consent only. Claim and credential consumption are durable; reload never resumes a write. */
export async function requestCoexistenceSync(identity: CoexistenceSyncIdentity, input: CoexistenceSyncInput, config: CoexistenceSyncConfig, ports: CoexistenceSyncPorts, clock: () => number = Date.now): Promise<{ ok: true; status: "pending" } | CoexistenceSyncFailure> {
  if (config.enabled !== true || !validConfig(config)) return fail("NEEDS_SETUP");
  if (!uuid(identity.companyId) || !uuid(identity.userId) || !uuid(identity.sessionId) || !uuid(input.requestId) || !uuid(input.linkId) || !generation(input.linkGeneration) || !types.includes(input.syncType) || input.consent !== true) return fail("INVALID_INPUT");
  const frozenIdentity = { companyId: identity.companyId.toLowerCase(), userId: identity.userId.toLowerCase(), sessionId: identity.sessionId.toLowerCase() };
  const frozenInput = { ...input, requestId: input.requestId.toLowerCase(), linkId: input.linkId.toLowerCase() };
  const reconcile = async () => { try { await ports.fail(); } catch { /* Sticky claim still blocks replay. */ } return fail("RECONCILIATION_REQUIRED"); };
  try {
    const claim = await ports.claim();
    if (!claim.ok) return claim.code === "UNAVAILABLE" || claim.code === "RECONCILIATION_REQUIRED" ? await reconcile() : claim;
    if (claim.stage !== "claimed" || !bound(claim, frozenIdentity, frozenInput, config)) return fail("FORBIDDEN");
    if (!windowValid(claim, clock())) return await reconcile();
    const authorization = await ports.authorize(claim);
    if (!authorization.ok || !bound(authorization.authorization, frozenIdentity, frozenInput, config) || !credentialValid(authorization.authorization, config, clock())) return await reconcile();
    const requested = await ports.provider(authorization.authorization);
    if (!requested.ok || !providerId(requested.requestId)) return await reconcile();
    const finalized = await ports.finalize(claim, requested.requestId);
    if (!finalized.ok) return await reconcile();
    // request_id acknowledges initiation only; authenticated webhooks prove progress.
    return { ok: true, status: "pending" };
  } catch { return await reconcile(); }
}

export async function sendCoexistenceSyncRequest(config: CoexistenceSyncConfig, authorization: CoexistenceSyncAuthorization, http: CoexistenceSyncFetch = fetch, clock: () => number = Date.now): Promise<CoexistenceSyncProviderResult> {
  if (config.enabled !== true || !validConfig(config)) return fail("NEEDS_SETUP");
  if (!credentialValid(authorization, config, clock())) return fail("RECONCILIATION_REQUIRED");
  try {
    const response = await http(`https://graph.facebook.com/${config.graphVersion}/${authorization.phoneNumberId}/smb_app_data`, {
      method: "POST", headers: { Authorization: `Bearer ${authorization.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", sync_type: authorization.syncType }), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return fail("RECONCILIATION_REQUIRED");
    const row = record(await response.json());
    return row && !row.error && row.messaging_product === "whatsapp" && providerId(row.request_id) ? { ok: true, requestId: row.request_id } : fail("RECONCILIATION_REQUIRED");
  } catch { return fail("RECONCILIATION_REQUIRED"); }
}

async function rpc(client: CoexistenceSyncRpcClient, name: string, args: Record<string, unknown>): Promise<({ ok: true } & Record<string, unknown>) | CoexistenceSyncFailure> {
  try { const result = await client.rpc(name, args), row = record(result.data); if (result.error || !row) return fail(); if (row.ok !== true) return fail(row.ok === false && codes.has(row.code as CoexistenceSyncFailureCode) ? row.code as CoexistenceSyncFailureCode : "UNAVAILABLE"); return { ...row, ok: true }; } catch { return fail(); }
}
function decodeClaim(row: Record<string, unknown>): CoexistenceSyncClaim | null {
  if (![row.request_id, row.company_id, row.user_id, row.session_id, row.link_id].every(uuid) || !generation(row.link_generation) || !types.includes(row.sync_type as CoexistenceSyncType)
    || typeof row.app_id !== "string" || typeof row.graph_version !== "string" || !timestamp(row.onboarded_at) || !timestamp(row.deadline_at)) return null;
  return { ok: true, requestId: String(row.request_id), companyId: String(row.company_id), userId: String(row.user_id), sessionId: String(row.session_id), linkId: String(row.link_id), linkGeneration: row.link_generation,
    syncType: row.sync_type as CoexistenceSyncType, appId: row.app_id, graphVersion: row.graph_version, stage: "claimed", onboardedAt: row.onboarded_at, deadlineAt: row.deadline_at };
}

export function createCoexistenceSyncPorts(identity: CoexistenceSyncIdentity, input: CoexistenceSyncInput, config: CoexistenceSyncConfig, session: CoexistenceSyncRpcClient, admin: CoexistenceSyncRpcClient, http: CoexistenceSyncFetch = fetch, clock: () => number = Date.now): CoexistenceSyncPorts {
  const heldIdentity = { ...identity }, heldInput = { ...input }, heldConfig = { ...config };
  const binding = { p_request_id: input.requestId.toLowerCase(), p_user_id: identity.userId.toLowerCase(), p_session_id: identity.sessionId.toLowerCase() };
  return {
    claim: async () => {
      const row = await rpc(session, "whatsapp_coexistence_claim_sync", { p_company_id: heldIdentity.companyId.toLowerCase(), p_request_id: heldInput.requestId.toLowerCase(), p_link_id: heldInput.linkId.toLowerCase(), p_link_generation: heldInput.linkGeneration, p_sync_type: heldInput.syncType, p_consent: heldInput.consent, p_app_id: heldConfig.appId, p_graph_version: heldConfig.graphVersion });
      if (!row.ok) return row; const claim = decodeClaim(row); return claim && row.stage === "claimed" && bound(claim, heldIdentity, heldInput, heldConfig) ? claim : fail();
    },
    authorize: async claim => {
      if (!bound(claim, heldIdentity, heldInput, heldConfig)) return fail("FORBIDDEN");
      const row = await rpc(admin, "whatsapp_coexistence_authorize_sync", binding);
      if (!row.ok) return row;
      const decoded = decodeClaim(row);
      if (!decoded || row.stage !== "executing" || !bound(decoded, heldIdentity, heldInput, heldConfig) || typeof row.access_token !== "string" || typeof row.phone_number_id !== "string" || typeof row.authorization_non_expiring !== "boolean" || (row.authorization_expires_at !== null && !timestamp(row.authorization_expires_at))) return fail();
      const authorization: CoexistenceSyncAuthorization = { ...decoded, stage: "executing", accessToken: row.access_token, phoneNumberId: row.phone_number_id, authorizationExpiresAt: row.authorization_expires_at as string | null, authorizationNonExpiring: row.authorization_non_expiring };
      return credentialValid(authorization, heldConfig, clock()) ? { ok: true, authorization } : fail();
    },
    provider: authorization => sendCoexistenceSyncRequest(heldConfig, authorization, http, clock),
    finalize: async (claim, providerRequestId) => {
      if (!bound(claim, heldIdentity, heldInput, heldConfig) || !providerId(providerRequestId)) return fail("INVALID_INPUT");
      const row = await rpc(admin, "whatsapp_coexistence_finalize_sync", { ...binding, p_provider_request_id: providerRequestId });
      if (!row.ok) return row; const decoded = decodeClaim(row); return decoded && bound(decoded, heldIdentity, heldInput, heldConfig) && row.stage === "requested" && row.provider_request_id === providerRequestId ? { ok: true } : fail();
    },
    fail: async () => { await rpc(admin, "whatsapp_coexistence_fail_sync", binding); },
  };
}

export async function readCoexistenceSyncReadiness(client: CoexistenceSyncRpcClient, companyId: string) {
  if (!uuid(companyId)) return fail("INVALID_INPUT");
  const row = await rpc(client, "whatsapp_coexistence_sync_readiness", { p_company_id: companyId.toLowerCase() });
  if (!row.ok) return row;
  return sameUuid(row.company_id, companyId) && row.version === "coexistence_sync_v1" && row.owner_requested_only === true && row.once_only === true && row.ai_enabled === false ? { ok: true as const, installed: true as const } : fail("NEEDS_SETUP");
}
export async function readCoexistenceSyncStatus(client: CoexistenceSyncRpcClient, companyId: string) {
  if (!uuid(companyId)) return fail("INVALID_INPUT");
  const row = await rpc(client, "whatsapp_coexistence_read_sync_status", { p_company_id: companyId.toLowerCase() });
  if (!row.ok) return row;
  if (!sameUuid(row.company_id, companyId) || row.ai_enabled !== false || !uuid(row.link_id) || !generation(row.link_generation) || !Array.isArray(row.syncs) || row.syncs.length !== 2) return fail();
  const seen = new Set<string>();
  const syncs: { syncType: CoexistenceSyncType; state: CoexistenceSyncState; requested: boolean; declined: boolean; errorCode: number | null; providerRequestId: string | null }[] = [];
  for (const raw of row.syncs) {
    const item = record(raw);
    if (!item || !types.includes(item.sync_type as CoexistenceSyncType) || seen.has(String(item.sync_type)) || !states.includes(item.state as CoexistenceSyncState) || typeof item.requested !== "boolean" || typeof item.declined !== "boolean"
      || (item.error_code !== null && (typeof item.error_code !== "number" || !Number.isSafeInteger(item.error_code) || item.error_code < 0 || item.state !== "failed")) || (item.provider_request_id !== null && !providerId(item.provider_request_id)) || item.requested !== (item.provider_request_id !== null) || item.declined !== (item.error_code === 2593109)) return fail();
    seen.add(String(item.sync_type)); syncs.push({ syncType: item.sync_type as CoexistenceSyncType, state: item.state as CoexistenceSyncState, requested: item.requested, declined: item.declined, errorCode: item.error_code as number | null, providerRequestId: item.provider_request_id as string | null });
  }
  // F4: optional until migration 20261101180000 is applied; the server still enforces the 24h window.
  const deadlineAt = timestamp(row.deadline_at) ? new Date(Date.parse(row.deadline_at)).toISOString() : null;
  return { ok: true as const, linkId: row.link_id, linkGeneration: row.link_generation, syncs, aiEnabled: false as const, deadlineAt };
}

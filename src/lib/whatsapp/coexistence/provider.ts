import "server-only";
import { selectServerCoexistenceAsset, type ServerFetchedPhoneAsset } from "./asset-selection";

export type CoexistenceProviderConfig = { enabled: boolean; appId: string; appSecret: string; systemUserToken?: string; graphVersion: string };
export type CoexistenceProviderInput = { code: string; wabaId?: string; phoneNumberId?: string; confirmedPhoneNumber: string };
export type CoexistenceProviderFailureCode = "NEEDS_SETUP" | "INVALID_INPUT" | "META_AUTHORIZATION_REJECTED" | "META_ASSET_REJECTED" | "META_UNAVAILABLE" | "RECONCILIATION_REQUIRED";
export type CoexistenceProviderFailure = { ok: false; code: CoexistenceProviderFailureCode };
export type CoexistenceProof = {
  app_id: string; waba_id: string; phone_number_id: string; display_phone_number: string;
  scopes: string[]; granular_scopes: { scope: string; target_ids: string[] }[];
  expires_at: number; data_access_expires_at: number; authorization_expires_at: string | null;
  platform_type: "CLOUD_API"; is_on_biz_app: true; subscribed: boolean; verified_at: string;
};
export type UnsubscribedCoexistenceProof = CoexistenceProof & { subscribed: false };
export type SubscribedCoexistenceProof = CoexistenceProof & { subscribed: true };
export type PreparedCoexistenceSignup = { ok: true; accessToken: string; proof: UnsubscribedCoexistenceProof };
export type CoexistencePreparedResult = PreparedCoexistenceSignup | CoexistenceProviderFailure;
export type CoexistenceSubscriptionResult = { ok: true; proof: SubscribedCoexistenceProof } | CoexistenceProviderFailure;
export type CoexistenceFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type CoexistenceClock = () => number;
const serverNow: CoexistenceClock = () => Math.floor(Date.now() / 1000);
const requiredScopes = ["whatsapp_business_management", "whatsapp_business_messaging"];
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const id = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,31}$/.test(value);
const canonicalNumber = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^[+\d ()-]+$/.test(value)) return null;
  const compact = value.replace(/[ ()-]/g, "");
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
};
const configured = (config: CoexistenceProviderConfig) => config.enabled === true && id(config.appId) && typeof config.appSecret === "string" && !!config.appSecret.trim() && typeof config.graphVersion === "string" && /^v\d+\.0$/.test(config.graphVersion);

function verifiedToken(value: unknown, appId: string, now: number, requestedWabaId?: string) {
  const data = object(value);
  if (!data || data.app_id !== appId || data.is_valid !== true || !Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now * 1000).getTime())) return null;
  const deadlines = [data.expires_at, data.data_access_expires_at];
  if (!deadlines.every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && (value === 0 || value > now) && Number.isFinite(new Date(value * 1000).getTime()))) return null;
  if (!Array.isArray(data.scopes) || !data.scopes.every(scope => typeof scope === "string") || !requiredScopes.every(scope => data.scopes instanceof Array && data.scopes.includes(scope)) || !Array.isArray(data.granular_scopes)) return null;
  const targets: Set<string>[] = [];
  for (const scope of requiredScopes) {
    const granted = new Set<string>();
    for (const raw of data.granular_scopes) {
      const grant = object(raw);
      if (!grant || typeof grant.scope !== "string") return null;
      if (grant.scope !== scope) continue;
      if (!Array.isArray(grant.target_ids) || grant.target_ids.length === 0 || !grant.target_ids.every(id)) return null;
      grant.target_ids.forEach(target => granted.add(target));
    }
    targets.push(granted);
  }
  const authorized = [...targets[0]].filter(target => targets[1].has(target));
  const wabaId = requestedWabaId ?? (authorized.length === 1 ? authorized[0] : undefined);
  if (!wabaId || !authorized.includes(wabaId)) return null;
  return { data, wabaId, scopes: [...data.scopes] as string[], expires: data.expires_at as number, dataExpires: data.data_access_expires_at as number };
}

function transport(config: CoexistenceProviderConfig, http: CoexistenceFetch) {
  const base = `https://graph.facebook.com/${config.graphVersion}/`;
  async function request(path: string, token?: string, query?: Record<string, string>, write = false) {
    const url = new URL(path, base);
    Object.entries(query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    if (write) headers["Content-Type"] = "application/json";
    // Exactly one attempt, including writes with unknown transport outcomes.
    const response = await http(url.toString(), { method: write ? "POST" : "GET", headers, body: write ? "{}" : undefined, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error("PROVIDER_UNAVAILABLE");
    const result = object(await response.json());
    if (!result || result.error) throw Error("PROVIDER_UNAVAILABLE");
    return result;
  }
  async function list(path: string, token: string, fields?: string) {
    const rows: unknown[] = [], seenCursors = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < 100; page++) {
      const result = await request(path, token, { limit: "100", ...(fields ? { fields } : {}), ...(after ? { after } : {}) });
      if (!Array.isArray(result.data)) throw Error("INCOMPLETE_PROVIDER_LIST");
      rows.push(...result.data);
      if (result.paging === undefined || result.paging === null) return rows;
      const paging = object(result.paging);
      if (!paging) throw Error("INCOMPLETE_PROVIDER_LIST");
      if (paging.next === undefined || paging.next === null || paging.next === "") return rows;
      const cursors = object(paging.cursors);
      if (typeof paging.next !== "string" || typeof cursors?.after !== "string" || !cursors.after || cursors.after.length > 2048 || seenCursors.has(cursors.after)) throw Error("INCOMPLETE_PROVIDER_LIST");
      after = cursors.after; seenCursors.add(after);
      // Only use its cursor on the fixed Graph endpoint, never follow paging.next.
    }
    throw Error("INCOMPLETE_PROVIDER_LIST");
  }
  return { request, list };
}

function proofFor(config: CoexistenceProviderConfig, token: NonNullable<ReturnType<typeof verifiedToken>>, phoneId: string, displayPhoneNumber: string, now: number): UnsubscribedCoexistenceProof {
  const deadlines = [token.expires, token.dataExpires].filter(value => value > 0);
  return {
    app_id: config.appId, waba_id: token.wabaId, phone_number_id: phoneId, display_phone_number: displayPhoneNumber,
    scopes: token.scopes, granular_scopes: requiredScopes.map(scope => ({ scope, target_ids: [token.wabaId] })),
    expires_at: token.expires, data_access_expires_at: token.dataExpires,
    authorization_expires_at: deadlines.length ? new Date(Math.min(...deadlines) * 1000).toISOString() : null,
    platform_type: "CLOUD_API", is_on_biz_app: true, subscribed: false, verified_at: new Date(now * 1000).toISOString(),
  };
}

/** Code exchange may create external authorization despite using GET. Checkpoint before subscribing. */
export async function prepareCoexistenceSignup(config: CoexistenceProviderConfig, input: CoexistenceProviderInput, http: CoexistenceFetch = fetch, clock: CoexistenceClock = serverNow): Promise<CoexistencePreparedResult> {
  if (!configured(config)) return { ok: false, code: "NEEDS_SETUP" };
  if (typeof input.code !== "string" || !input.code.trim() || input.code.length > 4096 || typeof input.confirmedPhoneNumber !== "string" || !/^\+[1-9]\d{6,14}$/.test(input.confirmedPhoneNumber) || (input.wabaId !== undefined && !id(input.wabaId)) || (input.phoneNumberId !== undefined && !id(input.phoneNumberId))) return { ok: false, code: "INVALID_INPUT" };
  const api = transport(config, http);
  let exchangeStarted = false;
  try {
    // A lost response can still mean the one-use code was consumed and a token issued.
    exchangeStarted = true;
    const exchange = await api.request("oauth/access_token", undefined, { client_id: config.appId, client_secret: config.appSecret, code: input.code });
    if (typeof exchange.access_token !== "string" || !exchange.access_token.trim()) return { ok: false, code: "META_AUTHORIZATION_REJECTED" };
    const accessToken = exchange.access_token;
    const now = clock();
    const token = verifiedToken((await api.request("debug_token", `${config.appId}|${config.appSecret}`, { input_token: accessToken })).data, config.appId, now, input.wabaId);
    if (!token) return { ok: false, code: "META_AUTHORIZATION_REJECTED" };
    if ((await api.request(token.wabaId, accessToken, { fields: "id" })).id !== token.wabaId) return { ok: false, code: "META_ASSET_REJECTED" };
    const rows = await api.list(`${token.wabaId}/phone_numbers`, accessToken, "id,display_phone_number,platform_type");
    const candidates = rows.map(object).filter(row => row && (input.phoneNumberId ? row.id === input.phoneNumberId : canonicalNumber(row.display_phone_number) === input.confirmedPhoneNumber));
    if (candidates.length !== 1 || !id(candidates[0]?.id)) return { ok: false, code: "META_ASSET_REJECTED" };
    const phone = await api.request(candidates[0].id, accessToken, { fields: "id,display_phone_number,is_on_biz_app,platform_type" });
    if (phone.id !== candidates[0].id || canonicalNumber(phone.display_phone_number) !== canonicalNumber(candidates[0].display_phone_number)) return { ok: false, code: "META_ASSET_REJECTED" };
    const enriched = rows.map(row => object(row)?.id === phone.id ? phone : row) as ServerFetchedPhoneAsset[];
    const verifiedNow = clock();
    const selected = selectServerCoexistenceAsset({ serverDebugTokenData: token.data, expectedAppId: config.appId, trustedNowEpochSeconds: verifiedNow, requestedWabaId: token.wabaId,
      serverPhoneAssets: [{ wabaId: token.wabaId, paginationComplete: true, phones: enriched }],
      requestedSelection: input.phoneNumberId ? { kind: "phone_id", phoneNumberId: input.phoneNumberId } : { kind: "phone_number", internationalPhoneNumber: input.confirmedPhoneNumber, confirmed: true } });
    if (!selected.ok || selected.normalizedPhoneNumber !== input.confirmedPhoneNumber) return { ok: false, code: selected.ok || !["TOKEN_REJECTED", "WABA_NOT_AUTHORIZED"].includes(selected.code) ? "META_ASSET_REJECTED" : "META_AUTHORIZATION_REJECTED" };
    return { ok: true, accessToken, proof: proofFor(config, token, selected.phoneNumberId, selected.normalizedPhoneNumber, verifiedNow) };
  } catch { return { ok: false, code: exchangeStarted ? "RECONCILIATION_REQUIRED" : "META_UNAVAILABLE" }; }
}

/** Invoke only after the service has committed the token/proof checkpoint. No registration API exists here. */
export async function subscribeAndVerifyCoexistence(config: CoexistenceProviderConfig, prepared: PreparedCoexistenceSignup, http: CoexistenceFetch = fetch, clock: CoexistenceClock = serverNow): Promise<CoexistenceSubscriptionResult> {
  if (!configured(config)) return { ok: false, code: "NEEDS_SETUP" };
  const { proof, accessToken } = prepared;
  if (!accessToken || proof.app_id !== config.appId || !id(proof.waba_id) || !id(proof.phone_number_id) || proof.subscribed !== false || proof.is_on_biz_app !== true || proof.platform_type !== "CLOUD_API") return { ok: false, code: "RECONCILIATION_REQUIRED" };
  const api = transport(config, http);
  try {
    const write = await api.request(`${proof.waba_id}/subscribed_apps`, accessToken, undefined, true);
    if (write.success !== true) return { ok: false, code: "RECONCILIATION_REQUIRED" };
    const apps = await api.list(`${proof.waba_id}/subscribed_apps`, accessToken);
    if (!apps.some(raw => object(object(raw)?.whatsapp_business_api_data)?.id === config.appId)) return { ok: false, code: "RECONCILIATION_REQUIRED" };
    const phone = await api.request(proof.phone_number_id, accessToken, { fields: "id,display_phone_number,is_on_biz_app,platform_type" });
    const now = clock();
    const token = verifiedToken((await api.request("debug_token", `${config.appId}|${config.appSecret}`, { input_token: accessToken })).data, config.appId, now, proof.waba_id);
    if (!token) return { ok: false, code: "RECONCILIATION_REQUIRED" };
    const displayPhoneNumber = canonicalNumber(phone.display_phone_number);
    // This is a direct asset readback, not a fabricated one-row complete list.
    if (phone.id !== proof.phone_number_id || phone.is_on_biz_app !== true || phone.platform_type !== "CLOUD_API" || displayPhoneNumber !== proof.display_phone_number) return { ok: false, code: "RECONCILIATION_REQUIRED" };
    return { ok: true, proof: { ...proofFor(config, token, proof.phone_number_id, displayPhoneNumber, now), subscribed: true } };
  } catch { return { ok: false, code: "RECONCILIATION_REQUIRED" }; }
}

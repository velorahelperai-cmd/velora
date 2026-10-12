/** Raw debug_token data fetched by the server for its own held access token. */
export interface ServerDebugTokenData {
  readonly app_id?: unknown;
  readonly is_valid?: unknown;
  readonly scopes?: unknown;
  readonly granular_scopes?: unknown;
  readonly expires_at?: unknown;
  readonly data_access_expires_at?: unknown;
}

/** Raw phone record fetched by the server from the stated WABA's phone list. */
export interface ServerFetchedPhoneAsset {
  readonly id?: unknown;
  readonly display_phone_number?: unknown;
  readonly is_on_biz_app?: unknown;
  readonly platform_type?: unknown;
}

export interface ServerFetchedWabaPhoneAssets {
  readonly wabaId: string;
  /** Set by the server only after it has fetched every page without errors. */
  readonly paginationComplete: boolean;
  readonly phones: readonly ServerFetchedPhoneAsset[];
}

export type RequestedCoexistenceSelection =
  | { readonly kind: "phone_id"; readonly phoneNumberId: string }
  | { readonly kind: "phone_number"; readonly internationalPhoneNumber: string; readonly confirmed: true };

export interface ServerAssetSelectionInput {
  readonly serverDebugTokenData: ServerDebugTokenData;
  readonly serverPhoneAssets: readonly ServerFetchedWabaPhoneAssets[];
  readonly expectedAppId: string;
  readonly trustedNowEpochSeconds: number;
  /** An optional requested account is a selection hint, never a scope grant. */
  readonly requestedWabaId?: string;
  readonly requestedSelection: RequestedCoexistenceSelection;
}

export type AssetSelectionFailureCode =
  | "TOKEN_REJECTED"
  | "WABA_NOT_AUTHORIZED"
  | "AMBIGUOUS_WABA"
  | "INVALID_SELECTION"
  | "INCOMPLETE_ASSET_LIST"
  | "DUPLICATE_ASSET_ID"
  | "INVALID_ASSET_DATA"
  | "PHONE_NOT_FOUND"
  | "AMBIGUOUS_PHONE"
  | "NOT_COEXISTENCE_ASSET";

export type ServerAssetSelectionResult =
  | { readonly ok: true; readonly wabaId: string; readonly phoneNumberId: string; readonly normalizedPhoneNumber: string }
  | { readonly ok: false; readonly code: AssetSelectionFailureCode };

const MANAGEMENT = "whatsapp_business_management";
const MESSAGING = "whatsapp_business_messaging";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function validExpiry(value: unknown, now: number): boolean {
  // Meta's numeric zero denotes no expiry. Missing values are not zero.
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && (value === 0 || value > now);
}

function normalizeNumber(value: unknown, requirePlus: boolean): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^[+\d() -]+$/.test(text)) return null;
  const compact = text.replace(/[() -]/g, "");
  if (requirePlus && !compact.startsWith("+")) return null;
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}

function scopedTargets(granular: unknown, requiredScope: string): Set<string> | null {
  if (!Array.isArray(granular)) return null;
  const targets = new Set<string>();
  for (const grant of granular) {
    if (!object(grant) || typeof grant.scope !== "string") return null;
    if (grant.scope !== requiredScope) continue;
    if (!Array.isArray(grant.target_ids) || grant.target_ids.length === 0 || !grant.target_ids.every(identifier)) return null;
    for (const target of grant.target_ids) targets.add(target);
  }
  return targets;
}

function reject(code: AssetSelectionFailureCode): ServerAssetSelectionResult {
  return { ok: false, code };
}

/**
 * Pure deterministic verification of server-fetched token grants and phone assets.
 * Call only after server-side tenant authorization and authenticated provider reads.
 * Never pass a browser callback object as serverDebugTokenData/serverPhoneAssets.
 * This result does not authenticate the caller, prove how inputs were obtained,
 * persist a connection, authorize provider writes, or enable sending.
 */
export function selectServerCoexistenceAsset(input: ServerAssetSelectionInput): ServerAssetSelectionResult {
  // Runtime checks also fail closed for malformed provider JSON despite the types.
  if (!object(input) || !object(input.serverDebugTokenData)) return reject("TOKEN_REJECTED");
  const now = input.trustedNowEpochSeconds;
  const token = input.serverDebugTokenData;
  if (!identifier(input.expectedAppId) || token.app_id !== input.expectedAppId || token.is_valid !== true ||
      typeof now !== "number" || !Number.isSafeInteger(now) || now < 0 ||
      !validExpiry(token.expires_at, now) || !validExpiry(token.data_access_expires_at, now)) {
    return reject("TOKEN_REJECTED");
  }
  if (!Array.isArray(token.scopes) || !token.scopes.includes(MANAGEMENT) || !token.scopes.includes(MESSAGING)) {
    return reject("WABA_NOT_AUTHORIZED");
  }
  const management = scopedTargets(token.granular_scopes, MANAGEMENT);
  const messaging = scopedTargets(token.granular_scopes, MESSAGING);
  if (!management || !messaging) return reject("WABA_NOT_AUTHORIZED");
  const authorizedWabas = [...management].filter(id => messaging.has(id));
  if (authorizedWabas.length === 0) return reject("WABA_NOT_AUTHORIZED");
  let wabaId: string;
  if (input.requestedWabaId !== undefined) {
    if (!identifier(input.requestedWabaId) || !authorizedWabas.includes(input.requestedWabaId)) return reject("WABA_NOT_AUTHORIZED");
    wabaId = input.requestedWabaId;
  } else {
    if (authorizedWabas.length !== 1) return reject("AMBIGUOUS_WABA");
    wabaId = authorizedWabas[0];
  }

  const selection = input.requestedSelection;
  if (!object(selection)) return reject("INVALID_SELECTION");
  let requestedPhoneId: string | undefined;
  let requestedNumber: string | null = null;
  if (selection.kind === "phone_id" && identifier(selection.phoneNumberId)) {
    requestedPhoneId = selection.phoneNumberId;
  } else if (selection.kind === "phone_number" && selection.confirmed === true) {
    requestedNumber = normalizeNumber(selection.internationalPhoneNumber, true);
    if (!requestedNumber) return reject("INVALID_SELECTION");
  } else {
    return reject("INVALID_SELECTION");
  }

  if (!Array.isArray(input.serverPhoneAssets) || input.serverPhoneAssets.length === 0) return reject("INCOMPLETE_ASSET_LIST");
  const seenWabas = new Set<string>();
  const seenPhones = new Set<string>();
  const selectedPhones: Array<{ asset: Record<string, unknown>; id: string; number: string }> = [];
  let selectedWabaFound = false;
  for (const list of input.serverPhoneAssets) {
    if (!object(list) || list.paginationComplete !== true || !Array.isArray(list.phones) || list.phones.length === 0) {
      return reject("INCOMPLETE_ASSET_LIST");
    }
    if (!identifier(list.wabaId)) return reject("INVALID_ASSET_DATA");
    if (seenWabas.has(list.wabaId)) return reject("DUPLICATE_ASSET_ID");
    seenWabas.add(list.wabaId);
    if (list.wabaId === wabaId) selectedWabaFound = true;
    for (const asset of list.phones) {
      if (!object(asset) || !identifier(asset.id)) return reject("INVALID_ASSET_DATA");
      if (seenPhones.has(asset.id)) return reject("DUPLICATE_ASSET_ID");
      seenPhones.add(asset.id);
      const number = normalizeNumber(asset.display_phone_number, false);
      if (!number) return reject("INVALID_ASSET_DATA");
      if (list.wabaId === wabaId && (requestedPhoneId ? asset.id === requestedPhoneId : number === requestedNumber)) {
        selectedPhones.push({ asset, id: asset.id, number });
      }
    }
  }
  if (!selectedWabaFound) return reject("INCOMPLETE_ASSET_LIST");
  if (selectedPhones.length === 0) return reject("PHONE_NOT_FOUND");
  if (selectedPhones.length !== 1) return reject("AMBIGUOUS_PHONE");
  const selected = selectedPhones[0];
  if (selected.asset.is_on_biz_app !== true || selected.asset.platform_type !== "CLOUD_API") return reject("NOT_COEXISTENCE_ASSET");
  return { ok: true, wabaId, phoneNumberId: selected.id, normalizedPhoneNumber: selected.number };
}

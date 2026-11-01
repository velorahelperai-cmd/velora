/**
 * Browser observations are untrusted selectors, never proof of authorization or connection.
 * v4 implementation and its older coexistence example disagree on returned IDs:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/
 * Revalidate assets, token and phone mode on the server before activation.
 */
export const MAX_SESSION_JSON_LENGTH = 16_384;
const TRUSTED_ORIGINS = new Set(["https://www.facebook.com", "https://web.facebook.com"]);
export type SignupMode = "coexistence" | "cloud-api-v4";
type AssetArrayKey = "ad_account_ids" | "page_ids" | "dataset_ids" | "catalog_ids" | "instagram_account_ids" | "waba_ids" | "messaging_account_ids";
export type SignupSelectors = Readonly<{
  waba_id: string;
  phone_number_id?: string;
  business_id?: string;
} & Partial<Record<AssetArrayKey, readonly string[]>>>;
/** Documented finish outcomes this route must not accept, with no automatic choice. */
export type SignupRejection = "wrong_route" | "only_waba" | "grant_only" | "multiple_accounts";
export type SignupFinish = Readonly<{
  kind: "finish";
  event: "FINISH" | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
  contract: "cloud-api-v4" | "coexistence" | "coexistence-v3-compat";
  data: SignupSelectors;
}>;
export type SignupObservation =
  | SignupFinish
  | Readonly<{ kind: "cancel"; currentStep?: string }>
  | Readonly<{ kind: "error"; event: "ERROR" | "CANCEL" }>
  | Readonly<{ kind: "rejected"; reason: SignupRejection }>
  | Readonly<{ kind: "unknown"; event: string }>
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "invalid" }>;

const ARRAY_KEYS: readonly AssetArrayKey[] = ["ad_account_ids", "page_ids", "dataset_ids", "catalog_ids", "instagram_account_ids", "waba_ids", "messaging_account_ids"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,31}$/.test(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 512;
const invalid = (): SignupObservation => ({ kind: "invalid" });

/** Only strings from exact allowed MessageEvent.origin values cross this boundary. */
export function parseEmbeddedSignupMessage(message: { origin: string; data: unknown }, mode: SignupMode): SignupObservation {
  if (!TRUSTED_ORIGINS.has(message.origin)) return { kind: "ignored" };
  if (typeof message.data !== "string" || message.data.length > MAX_SESSION_JSON_LENGTH) return invalid();
  let payload: unknown;
  try { payload = JSON.parse(message.data); } catch { return invalid(); }
  if (!isRecord(payload)) return invalid();
  if (payload.type !== "WA_EMBEDDED_SIGNUP") return { kind: "ignored" };
  if (!isText(payload.event) || !isRecord(payload.data)) return invalid();
  if (mode !== "coexistence" && mode !== "cloud-api-v4") return invalid();
  const event = payload.event;
  const data = payload.data;
  if (event === "ERROR") return { kind: "error", event };
  if (event === "CANCEL") {
    // The current implementation documents reported errors as CANCEL too.
    if ("error_message" in data || "error_code" in data || "session_id" in data || "timestamp" in data) {
      if (!["error_message", "error_code", "session_id", "timestamp"].every((key) => isText(data[key]))) return invalid();
      return { kind: "error", event };
    }
    if ("current_step" in data && !isText(data.current_step)) return invalid();
    return { kind: "cancel", ...(isText(data.current_step) ? { currentStep: data.current_step } : {}) };
  }
  if (event === "FINISH_ONLY_WABA") return { kind: "rejected", reason: "only_waba" };
  if (event === "FINISH_GRANT_ONLY_API_ACCESS") return { kind: "rejected", reason: "grant_only" };
  if (event !== "FINISH" && event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") return { kind: "unknown", event };
  // v5: event is FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING when is_on_biz_app is true, FINISH when false.
  if ("is_on_biz_app" in data && typeof data.is_on_biz_app !== "boolean") return invalid();
  if (typeof data.is_on_biz_app === "boolean" && data.is_on_biz_app !== (event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")) return invalid();
  if ((event === "FINISH") !== (mode === "cloud-api-v4")) return mode === "coexistence" ? { kind: "rejected", reason: "wrong_route" } : invalid();
  // Unknown top-level and data keys (including other versions) are ignored; only known ID fields are trusted and strictly checked.
  // v5 messaging_account_ids replaces waba_id. Several distinct accounts are never auto-chosen.
  const accounts = new Set<string>();
  if ("waba_id" in data) { if (!isId(data.waba_id)) return invalid(); accounts.add(data.waba_id); }
  for (const key of ["messaging_account_ids", "waba_ids"] as const) {
    if (!(key in data)) continue;
    const ids = data[key];
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(isId)) return invalid();
    ids.forEach((id) => accounts.add(id));
  }
  if (accounts.size > 1) return { kind: "rejected", reason: "multiple_accounts" };
  const wabaId = [...accounts][0];
  if (!isId(wabaId)) return invalid();
  if (["phone_number_id", "business_id"].some((key) => key in data && !isId(data[key]))) return invalid();
  if (mode === "cloud-api-v4" && (!isId(data.phone_number_id) || !isId(data.business_id))) return invalid();
  const selectors: { waba_id: string; phone_number_id?: string; business_id?: string } & Partial<Record<AssetArrayKey, readonly string[]>> = { waba_id: wabaId };
  if (isId(data.phone_number_id)) selectors.phone_number_id = data.phone_number_id;
  if (isId(data.business_id)) selectors.business_id = data.business_id;
  for (const key of ARRAY_KEYS) {
    if (!(key in data)) continue;
    const ids = data[key];
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(isId)) return invalid();
    selectors[key] = Object.freeze([...ids]);
  }
  return Object.freeze({
    kind: "finish", event, data: Object.freeze(selectors),
    contract: mode === "cloud-api-v4" ? "cloud-api-v4" : event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" && payload.version === 3 ? "coexistence-v3-compat" : "coexistence",
  });
}

/** Embedded Signup v5: Business app onboarding is on by default, so no featureType; sessionInfoVersion is not an input.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-5/ */
export function coexistenceLoginOptions(configId: string) {
  if (!isText(configId)) throw new Error("A configuration ID is required");
  return {
    config_id: configId,
    response_type: "code" as const,
    override_default_response_type: true as const,
    extras: { setup: {}, version: "v5" as const },
  };
}

export type SignupAttempt = Readonly<{
  attemptId: string;
  status: "waiting" | "ready-for-server-validation" | "conflict" | "cancelled" | "error";
  /** Ephemeral exchange code: do not persist or log. */
  code?: string;
  session?: SignupFinish;
}>;
export type SignupSignal = SignupObservation | Readonly<{ kind: "code"; code: string }>;

/** Reset by constructing a new attempt ID and binding both callbacks to that ID. */
export function createSignupAttempt(attemptId: string): SignupAttempt {
  if (!isText(attemptId)) throw new Error("A fresh attempt ID is required");
  return Object.freeze({ attemptId, status: "waiting" });
}

/** Readonly types do not prevent callers from supplying mutable structural values. */
function snapshotFinish(signal: SignupFinish): SignupFinish | undefined {
  if (!["cloud-api-v4", "coexistence", "coexistence-v3-compat"].includes(signal.contract)) return undefined;
  try {
    const wire = JSON.stringify({
      type: "WA_EMBEDDED_SIGNUP", event: signal.event, data: signal.data,
      ...(signal.contract === "coexistence-v3-compat" ? { version: 3 } : {}),
    });
    // Reuse the same schema and bounds; the parser copies and freezes every nested array.
    const snapshot = parseEmbeddedSignupMessage(
      { origin: "https://www.facebook.com", data: wire },
      signal.contract === "cloud-api-v4" ? "cloud-api-v4" : "coexistence",
    );
    return snapshot.kind === "finish" && snapshot.contract === signal.contract ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

/** Never combine callbacks from different attempts or silently replace completion data. */
export function joinSignupSignal(state: SignupAttempt, attemptId: string, signal: SignupSignal): SignupAttempt {
  if (attemptId !== state.attemptId || ["conflict", "cancelled", "error"].includes(state.status)) return state;
  const terminal = (status: "conflict" | "cancelled" | "error"): SignupAttempt => Object.freeze({ attemptId, status });
  if (signal.kind === "cancel") return terminal("cancelled");
  if (signal.kind === "error" || signal.kind === "rejected") return terminal("error");
  if (signal.kind !== "code" && signal.kind !== "finish") return state;
  const completion = signal.kind === "finish" ? snapshotFinish(signal) : undefined;
  if (signal.kind === "finish" && completion === undefined) return terminal("error");
  if (signal.kind === "code") {
    if (typeof signal.code !== "string" || signal.code.length === 0 || signal.code.length > 8192 || !signal.code.trim()) return terminal("error");
    if (state.code !== undefined) return state.code === signal.code ? state : terminal("conflict");
  } else if (state.session !== undefined) {
    // Parser output uses deterministic field order. Different optional IDs are a conflict,
    // not permission to enrich an earlier payload with potentially stale selectors.
    return JSON.stringify(state.session) === JSON.stringify(completion) ? state : terminal("conflict");
  }
  const code = signal.kind === "code" ? signal.code : state.code;
  const session = signal.kind === "finish" ? completion : state.session;
  return Object.freeze({
    attemptId, status: code && session ? "ready-for-server-validation" : "waiting",
    ...(code !== undefined ? { code } : {}), ...(session !== undefined ? { session } : {}),
  });
}

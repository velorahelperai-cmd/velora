import "server-only";
import { es02Uuid } from "./contracts";

export type ThawaniTestConfig = { secretKey: string; publicKey: string; accountId: string };
export type ThawaniBinding = { reference: string; amountBaisa: number; token: string };
export type ThawaniSession = { sessionId: string; status: "paid" | "unpaid" | "cancelled"; invoice: string };
const base = "https://uatcheckout.thawani.om";
const sessionPattern = /^checkout_[A-Za-z0-9]{8,150}$/;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function readThawaniTestConfig(env: Record<string, string | undefined>): ThawaniTestConfig | null {
  if (env.BILLING_ES02_THAWANI_TEST_ENABLED !== "true" || env.THAWANI_ENVIRONMENT !== "uat" || !es02Uuid(env.THAWANI_TEST_ACCOUNT_ID)) return null;
  const secretKey = env.THAWANI_SECRET_KEY_TEST?.trim() ?? "";
  const publicKey = env.THAWANI_PUBLIC_KEY_TEST?.trim() ?? "";
  if (![secretKey, publicKey].every(key => /^[A-Za-z0-9_-]{8,256}$/.test(key))) return null;
  return { secretKey, publicKey, accountId: env.THAWANI_TEST_ACCOUNT_ID! };
}

export function matchThawaniSession(value: unknown, binding: ThawaniBinding): ThawaniSession | null {
  const row = object(value);
  if (!row || typeof row.session_id !== "string" || !sessionPattern.test(row.session_id)
    || row.client_reference_id !== binding.reference || row.total_amount !== binding.amountBaisa
    || row.currency !== "OMR" || row.mode !== "payment" || object(row.metadata)?.binding !== binding.token
    || !["paid", "unpaid", "cancelled"].includes(String(row.payment_status))
    || typeof row.invoice !== "string" || !/^[0-9]{1,50}$/.test(row.invoice)) return null;
  return { sessionId: row.session_id, status: row.payment_status as ThawaniSession["status"], invoice: row.invoice };
}

async function request(config: ThawaniTestConfig, path: string, init: RequestInit, http: typeof fetch): Promise<unknown> {
  const response = await http(base + "/api/v1" + path, { ...init, headers: { "Content-Type": "application/json", "thawani-api-key": config.secretKey }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok || Number(response.headers.get("content-length")) > 65536) throw new Error("thawani_outcome_unknown");
  const text = await response.text();
  if (text.length > 65536) throw new Error("thawani_outcome_unknown");
  const payload = object(JSON.parse(text));
  if (payload?.success !== true) throw new Error("thawani_outcome_unknown");
  return payload.data;
}

export function thawaniTestCheckoutUrl(config: ThawaniTestConfig, sessionId: string): string {
  if (!sessionPattern.test(sessionId)) throw new Error("thawani_invalid_session");
  const url = new URL(base + "/pay/" + sessionId);
  url.searchParams.set("key", config.publicKey);
  return url.href;
}

export async function createThawaniTestSession(config: ThawaniTestConfig, binding: ThawaniBinding, returnUrl: string, http: typeof fetch = fetch): Promise<ThawaniSession> {
  const target = new URL(returnUrl);
  if (target.origin !== "https://www.velorahelper.com" || !/^\/account\/payment\/[0-9a-f-]{36}$/.test(target.pathname) || target.search || target.hash || target.username || target.password
    || !Number.isSafeInteger(binding.amountBaisa) || binding.amountBaisa < 100 || !binding.reference || !binding.token) throw new Error("thawani_invalid_binding");
  const row = await request(config, "/checkout/session", { method: "POST", body: JSON.stringify({
    client_reference_id: binding.reference, mode: "payment", products: [{ name: "Velora Test subscription", quantity: 1, unit_amount: binding.amountBaisa }],
    success_url: returnUrl, cancel_url: returnUrl, save_card_on_success: false, expire_in_minutes: 1440,
    metadata: { binding: binding.token },
  }) }, http);
  const session = matchThawaniSession(row, binding);
  if (!session || session.status !== "unpaid") throw new Error("thawani_invalid_session");
  return session;
}

export async function readThawaniTestSession(config: ThawaniTestConfig, sessionId: string, binding: ThawaniBinding, http: typeof fetch = fetch): Promise<ThawaniSession> {
  if (!sessionPattern.test(sessionId)) throw new Error("thawani_invalid_session");
  const row = await request(config, "/checkout/session/" + sessionId, { method: "GET" }, http);
  const session = matchThawaniSession(row, binding);
  if (!session || session.sessionId !== sessionId) throw new Error("thawani_binding_mismatch");
  return session;
}

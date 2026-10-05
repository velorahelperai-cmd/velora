import { externalSendAllowed, sendReady, whatsappConfig, whatsappRoutingMode } from "./config";

export type SendTextResult =
  | { ok: true; waMessageId: string }
  | {
      ok: false;
      code:
        | "NOT_CONFIGURED"
        | "NEEDS_SETUP"
        | "SEND_DISABLED"
        | "PHONE_MISMATCH"
        | "GRAPH_REJECTED"
        | "AMBIGUOUS";
      detail?: string;
    };

const SEND_TIMEOUT_MS = 25_000;

type GraphErrorPayload = {
  messages?: Array<{ id?: string }>;
  error?: { message?: string; type?: string; code?: number | string };
};

/**
 * Confirmed provider rejection requires a readable Graph error object.
 * Unreadable bodies, 5xx, and other non-OK responses without clear reject evidence → AMBIGUOUS.
 */
function classifyHttpFailure(
  response: Response,
  payload: GraphErrorPayload | null,
): Extract<SendTextResult, { ok: false }> {
  const graphError = payload?.error;
  const hasClearReject =
    graphError != null
    && typeof graphError === "object"
    && (typeof graphError.message === "string" || graphError.code != null)
    && response.status >= 400
    && response.status < 500;

  if (hasClearReject) {
    return {
      ok: false,
      code: "GRAPH_REJECTED",
      detail: typeof graphError.message === "string"
        ? graphError.message
        : `graph_${String(graphError.code)}`,
    };
  }

  return {
    ok: false,
    code: "AMBIGUOUS",
    detail: payload == null
      ? `unreadable_${response.status}`
      : response.status >= 500
        ? `server_${response.status}`
        : `unclear_${response.status}`,
  };
}

/**
 * Sends a text message through WhatsApp Cloud API.
 * Requires WHATSAPP_ALLOW_EXTERNAL_SEND=true. Do not invoke from automatic AI paths.
 * single_tenant: phoneNumberId must match env — never silently fall back to another number.
 * tenant_registry: caller must pass the per-number token; env token is never used.
 */
export async function sendWhatsappText(input: {
  toWaId: string;
  body: string;
  /** Bound conversation / intent phone number id. */
  phoneNumberId: string;
  /** Required in tenant_registry. Ignored in single_tenant (env token only). */
  accessToken?: string;
  signal?: AbortSignal;
}): Promise<SendTextResult> {
  if (!externalSendAllowed()) return { ok: false, code: "SEND_DISABLED" };

  const boundPhone = input.phoneNumberId.trim();
  if (!boundPhone) return { ok: false, code: "PHONE_MISMATCH" };

  const mode = whatsappRoutingMode();
  const config = whatsappConfig();
  let accessToken = "";
  if (mode === "tenant_registry") {
    accessToken = input.accessToken?.trim() ?? "";
    if (!accessToken) return { ok: false, code: "NEEDS_SETUP" };
  } else {
    if (!sendReady(config)) return { ok: false, code: "NOT_CONFIGURED" };
    if (boundPhone !== config.phoneNumberId) {
      return { ok: false, code: "PHONE_MISMATCH" };
    }
    accessToken = config.accessToken;
  }

  const to = input.toWaId.replace(/\D/g, "");
  const text = input.body.trim().slice(0, 4096);
  if (!to || !text) return { ok: false, code: "GRAPH_REJECTED", detail: "empty" };

  const timeout = AbortSignal.timeout(SEND_TIMEOUT_MS);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeout])
    : timeout;

  let response: Response;
  let payload: GraphErrorPayload | null;
  try {
    response = await fetch(
      `https://graph.facebook.com/v22.0/${boundPhone}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
        signal,
      },
    );
    payload = (await response.json().catch(() => null)) as GraphErrorPayload | null;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      ok: false,
      code: "AMBIGUOUS",
      detail: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    };
  }

  const waMessageId = payload?.messages?.[0]?.id;
  if (response.ok && waMessageId) {
    return { ok: true, waMessageId };
  }

  if (response.ok && !waMessageId) {
    return { ok: false, code: "AMBIGUOUS", detail: "missing_provider_id" };
  }

  return classifyHttpFailure(response, payload);
}

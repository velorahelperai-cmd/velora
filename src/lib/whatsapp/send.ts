import { externalSendAllowed, sendReady, whatsappConfig } from "./config";

export type SendTextResult =
  | { ok: true; waMessageId: string }
  | {
      ok: false;
      code:
        | "NOT_CONFIGURED"
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
 * phoneNumberId must match server config — never silently fall back to another number.
 */
export async function sendWhatsappText(input: {
  toWaId: string;
  body: string;
  /** Bound conversation / intent phone number id — must equal server config. */
  phoneNumberId: string;
  signal?: AbortSignal;
}): Promise<SendTextResult> {
  if (!externalSendAllowed()) return { ok: false, code: "SEND_DISABLED" };
  const config = whatsappConfig();
  if (!sendReady(config)) return { ok: false, code: "NOT_CONFIGURED" };

  const boundPhone = input.phoneNumberId.trim();
  if (!boundPhone || boundPhone !== config.phoneNumberId) {
    return { ok: false, code: "PHONE_MISMATCH" };
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
          authorization: `Bearer ${config.accessToken}`,
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

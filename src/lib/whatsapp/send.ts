import { externalSendAllowed, metaGraphVersion, sendReady, whatsappConfig, whatsappRoutingMode } from "./config";

export type SendTextResult =
  | { ok: true; waMessageId: string }
  | {
      ok: false;
      code:
        | "NOT_CONFIGURED"
        | "NEEDS_SETUP"
        | "SEND_DISABLED"
        | "PHONE_MISMATCH"
        | "SERVICE_WINDOW_CLOSED"
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
      // Graph messages can echo tokens, request bodies and recipient details.
      detail: /^\d{1,8}$/.test(String(graphError.code ?? ""))
        ? `graph_${String(graphError.code)}` : "graph_rejected",
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
  /** Server evidence from whatsapp_check_service_window; required for tenant freeform sends. */
  serviceWindowExpiresAt?: string;
  signal?: AbortSignal;
}): Promise<SendTextResult> {
  if (!externalSendAllowed()) return { ok: false, code: "SEND_DISABLED" };

  const boundPhone = input.phoneNumberId.trim();
  if (!boundPhone) return { ok: false, code: "PHONE_MISMATCH" };

  const mode = whatsappRoutingMode();
  const config = whatsappConfig();
  let accessToken = "";
  let graphVersion = "v22.0"; // Explicit legacy single-tenant compatibility.
  if (mode === "tenant_registry") {
    accessToken = input.accessToken?.trim() ?? "";
    if (!accessToken) return { ok: false, code: "NEEDS_SETUP" };
    const configuredVersion = metaGraphVersion();
    if (!configuredVersion) return { ok: false, code: "NEEDS_SETUP" };
    graphVersion = configuredVersion;
    const now = Date.now();
    const expires = input.serviceWindowExpiresAt ? Date.parse(input.serviceWindowExpiresAt) : NaN;
    // A future customer timestamp must never manufacture a window beyond 24 hours.
    if (!Number.isFinite(expires) || expires <= now || expires > now + 24 * 60 * 60 * 1000) {
      return { ok: false, code: "SERVICE_WINDOW_CLOSED" };
    }
  } else {
    if (!sendReady(config)) return { ok: false, code: "NOT_CONFIGURED" };
    if (boundPhone !== config.phoneNumberId) {
      return { ok: false, code: "PHONE_MISMATCH" };
    }
    accessToken = config.accessToken;
  }

  // Preserve the recipient identity retained by the intent; never reinterpret it.
  const to = input.toWaId;
  if (!/^\d+$/.test(to)) return { ok: false, code: "GRAPH_REJECTED", detail: "invalid_recipient" };
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
      `https://graph.facebook.com/${graphVersion}/${boundPhone}/messages`,
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

  const providerId = Array.isArray(payload?.messages) && payload.messages.length === 1
    ? payload.messages[0]?.id
    : null;
  const waMessageId = typeof providerId === "string" && providerId.trim() === providerId && providerId.length > 0
    ? providerId
    : null;
  if (response.ok && payload?.error != null) {
    return { ok: false, code: "AMBIGUOUS", detail: "contradictory_provider_response" };
  }
  if (response.ok && waMessageId) {
    return { ok: true, waMessageId };
  }

  if (response.ok && !waMessageId) {
    return { ok: false, code: "AMBIGUOUS", detail: "missing_provider_id" };
  }

  return classifyHttpFailure(response, payload);
}

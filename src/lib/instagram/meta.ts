import { instagramConfig } from "./config";

export type InstagramTextInput = {
  /** Exact professional account retained by the authorized immutable intent. */
  professionalAccountId: string;
  /** Exact IGSID retained by that intent; never convert identifiers to numbers. */
  recipientId: string;
  text: string;
  /** Bound account's server-only Instagram User token. No environment fallback. */
  accessToken: string;
  signal?: AbortSignal;
};

export type InstagramSendResult =
  | { status: "blocked"; code: "SEND_DISABLED" | "NEEDS_SETUP" | "INVALID_INPUT" }
  | { status: "accepted"; recipientId: string; messageId: string; delivery: "unconfirmed" }
  | { status: "rejected"; code: "GRAPH_REJECTED"; detail: string }
  | { status: "unknown"; code: "AMBIGUOUS" };

const unknown = (): InstagramSendResult => ({ status: "unknown", code: "AMBIGUOUS" });
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * One HTTP attempt only, after future authoritative intent/window/entitlement
 * authorization. This adapter neither establishes that authority nor retrieves
 * credentials, persists receipts, invokes AI, retries or claims delivery.
 * Runtime configuration keeps dispatch disabled during this preparation.
 */
export async function sendInstagramText(
  input: InstagramTextInput,
  dependencies: { fetch?: typeof fetch } = {},
): Promise<InstagramSendResult> {
  const config = instagramConfig();
  if (!config.sendEnabled) return { status: "blocked", code: "SEND_DISABLED" };
  if (config.graphVersion !== "v26.0") return { status: "blocked", code: "NEEDS_SETUP" };
  try {
    // Capture exact request binding before the first await; caller mutation cannot
    // make a response for another recipient look like acceptance of this intent.
    const dispatch = Object.freeze({
      professionalAccountId: input.professionalAccountId, recipientId: input.recipientId,
      text: input.text, accessToken: input.accessToken, signal: input.signal,
    });
    if (
      typeof dispatch.professionalAccountId !== "string" || !/^\d{1,64}$/.test(dispatch.professionalAccountId)
      || typeof dispatch.recipientId !== "string" || !/^\d{1,64}$/.test(dispatch.recipientId)
      || typeof dispatch.text !== "string" || dispatch.text.length === 0
      || new TextEncoder().encode(dispatch.text).byteLength > 1000
      || typeof dispatch.accessToken !== "string" || !dispatch.accessToken.trim()
      || /[\s\x00-\x1f\x7f]/.test(dispatch.accessToken)
    ) return { status: "blocked", code: "INVALID_INPUT" };
    const timeout = AbortSignal.timeout(25_000);
    const response = await (dependencies.fetch ?? globalThis.fetch)(
      `https://graph.instagram.com/${config.graphVersion}/${dispatch.professionalAccountId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${dispatch.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: dispatch.recipientId }, message: { text: dispatch.text } }),
        redirect: "error",
        cache: "no-store",
        signal: dispatch.signal ? AbortSignal.any([dispatch.signal, timeout]) : timeout,
      },
    );
    let payload: unknown;
    try { payload = await response.json(); } catch { return unknown(); }
    if (!record(payload)) return unknown();

    if (response.ok) {
      if (
        payload.recipient_id !== dispatch.recipientId
        || typeof payload.message_id !== "string" || !payload.message_id
        || /\s|[\x00-\x1f\x7f]/.test(payload.message_id)
      ) return unknown();
      return { status: "accepted", recipientId: dispatch.recipientId, messageId: payload.message_id, delivery: "unconfirmed" };
    }
    const error = payload.error;
    if (response.status >= 400 && response.status < 500 && record(error)
      && ((typeof error.message === "string" && error.message.trim().length > 0)
        || ((typeof error.code === "string" || typeof error.code === "number") && /^\d{1,8}$/.test(String(error.code))))) {
      // Provider error messages may echo tokens/text. Only bounded numeric codes leave the adapter.
      const code = String(error.code ?? "");
      return { status: "rejected", code: "GRAPH_REJECTED", detail: /^\d{1,8}$/.test(code) ? `graph_${code}` : "graph_rejected" };
    }
    return unknown();
  } catch {
    // A lost/aborted response cannot prove that the provider did not accept it.
    return unknown();
  }
}

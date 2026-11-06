import "server-only";
import { externalSendAllowed } from "./config";
import { continuityAckGate, NEUTRAL_ACK_TEXT } from "./response-continuity";
import { sendWhatsappText, type SendTextResult } from "./send";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
type Sender = (input: { toWaId: string; body: string; phoneNumberId: string; accessToken: string; serviceWindowExpiresAt: string }) => Promise<SendTextResult>;

export type ContinuityAckRun = {
  claimed: number;
  dispatched: number;
  code: "ACK_GATE_CLOSED" | "SEND_DISABLED" | "COMPLETE" | "SEND_REQUIRES_REVIEW" | "WATCHDOG_UNAVAILABLE";
};

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * Claims due ack rows and dispatches at most one neutral text per row.
 * The ack gate and the external-send gate both have to be exactly true.
 * A closed service window is blocked here. This path does not send a template.
 * UNKNOWN is finalized once and is not retried.
 */
export async function runContinuityAckWatchdog(rpc: Rpc, send: Sender = sendWhatsappText): Promise<ContinuityAckRun> {
  if (!continuityAckGate().open) return { claimed: 0, dispatched: 0, code: "ACK_GATE_CLOSED" };
  if (!externalSendAllowed()) return { claimed: 0, dispatched: 0, code: "SEND_DISABLED" };
  let claimedRows: unknown[];
  try {
    const response = await rpc("whatsapp_claim_continuity_watchdog", { p_limit: 5 });
    const data = object(response.data);
    if (response.error || data?.ok !== true || data.dispatch !== false || !Array.isArray(data.claimed)) {
      return { claimed: 0, dispatched: 0, code: "WATCHDOG_UNAVAILABLE" };
    }
    claimedRows = data.claimed;
  } catch {
    return { claimed: 0, dispatched: 0, code: "WATCHDOG_UNAVAILABLE" };
  }
  let dispatched = 0;
  let review = false;
  for (const raw of claimedRows) {
    const row = object(raw);
    if (!row || typeof row.id !== "string" || typeof row.claim_token !== "string") {
      review = true;
      continue;
    }
    const binding = { p_intent_id: row.id, p_claim_token: row.claim_token };
    let auth: Record<string, unknown>;
    try {
      const response = await rpc("whatsapp_authorize_continuity_ack", binding);
      const data = object(response.data);
      if (response.error || !data) { review = true; continue; }
      if (data.ok !== true) continue;
      auth = data;
    } catch {
      review = true;
      continue;
    }
    if (auth.freeform !== true || auth.template !== false || auth.body !== NEUTRAL_ACK_TEXT || auth.service_window_open !== true) continue;
    if (typeof auth.phone_number_id !== "string" || typeof auth.recipient_wa_id !== "string" || typeof auth.service_window_expires_at !== "string"
      || typeof auth.link_id !== "string" || typeof auth.company_id !== "string" || !Number.isSafeInteger(auth.link_generation)) {
      review = true;
      continue;
    }
    let secret: Record<string, unknown> | null = null;
    try {
      const response = await rpc("whatsapp_read_link_access_secret", {
        p_company_id: auth.company_id, p_link_id: auth.link_id, p_phone_number_id: auth.phone_number_id, p_link_generation: auth.link_generation,
      });
      secret = object(response.data);
      if (response.error || secret?.access_token == null || typeof secret.access_token !== "string") { review = true; continue; }
    } catch {
      review = true;
      continue;
    }
    let sent: SendTextResult;
    try {
      sent = await send({
        toWaId: auth.recipient_wa_id,
        body: NEUTRAL_ACK_TEXT,
        phoneNumberId: auth.phone_number_id,
        accessToken: secret.access_token,
        serviceWindowExpiresAt: auth.service_window_expires_at,
      });
    } catch {
      sent = { ok: false, code: "AMBIGUOUS" };
    }
    const outcome = sent.ok ? "accepted" : sent.code === "GRAPH_REJECTED" || sent.code === "SEND_DISABLED" || sent.code === "SERVICE_WINDOW_CLOSED" || sent.code === "NEEDS_SETUP" ? "rejected" : "unknown";
    try {
      await rpc("whatsapp_finalize_continuity_ack", {
        ...binding,
        p_result: outcome,
        p_wa_message_id: sent.ok ? sent.waMessageId : null,
      });
    } catch {
      review = true;
    }
    if (outcome === "accepted") dispatched += 1;
    if (outcome === "unknown") review = true;
  }
  return { claimed: claimedRows.length, dispatched, code: review ? "SEND_REQUIRES_REVIEW" : "COMPLETE" };
}

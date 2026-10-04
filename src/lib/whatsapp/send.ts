import { sendReady, whatsappConfig } from "@/lib/whatsapp/config";

export type SendTextResult =
  | { ok: true; waMessageId: string }
  | { ok: false; code: "NOT_CONFIGURED" | "GRAPH_ERROR"; detail?: string };

/**
 * Sends a text message through WhatsApp Cloud API.
 * Call only after an explicit user-approved test. Do not invoke from automatic AI paths.
 */
export async function sendWhatsappText(input: {
  toWaId: string;
  body: string;
}): Promise<SendTextResult> {
  const config = whatsappConfig();
  if (!sendReady(config)) return { ok: false, code: "NOT_CONFIGURED" };

  const to = input.toWaId.replace(/\D/g, "");
  const text = input.body.trim().slice(0, 4096);
  if (!to || !text) return { ok: false, code: "GRAPH_ERROR", detail: "empty" };

  const response = await fetch(
    `https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`,
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
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | { messages?: Array<{ id?: string }>; error?: { message?: string } }
    | null;
  const waMessageId = payload?.messages?.[0]?.id;
  if (!response.ok || !waMessageId) {
    return {
      ok: false,
      code: "GRAPH_ERROR",
      detail: payload?.error?.message || `status_${response.status}`,
    };
  }
  return { ok: true, waMessageId };
}

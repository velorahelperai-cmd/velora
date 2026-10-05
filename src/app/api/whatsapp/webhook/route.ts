import { createAdminClient } from "@/lib/supabase/admin";
import { webhookReady, whatsappConfig } from "@/lib/whatsapp/config";
import { saveInbound, saveStatus } from "@/lib/whatsapp/store";
import { signatureMatches, splitWebhook, verifyChallenge } from "@/lib/whatsapp/webhook";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const challenge = verifyChallenge(
    {
      mode: url.searchParams.get("hub.mode"),
      token: url.searchParams.get("hub.verify_token"),
      challenge: url.searchParams.get("hub.challenge"),
    },
    whatsappConfig().verifyToken,
  );
  if (!challenge) return new Response("forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request) {
  const config = whatsappConfig();
  if (!webhookReady(config)) return new Response("not configured", { status: 503 });

  const raw = await request.text();
  if (!signatureMatches(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) return new Response("not configured", { status: 503 });

  // Single-company binding from server config only — not from the browser or payload company fields.
  const companyId = config.companyId;
  const phoneNumberId = config.phoneNumberId;

  const { messages, statuses } = splitWebhook(payload);

  try {
    for (const message of messages) {
      if (message.phoneNumberId !== phoneNumberId) continue;
      await saveInbound(admin, companyId, message);
    }
    for (const status of statuses) {
      if (status.phoneNumberId !== phoneNumberId) continue;
      await saveStatus(admin, companyId, status);
    }
  } catch {
    // Durable persist failed — do not ack success (allows provider redelivery).
    return new Response("store failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

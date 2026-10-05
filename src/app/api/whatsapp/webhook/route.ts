import { createAdminClient } from "@/lib/supabase/admin";
import { webhookReady, whatsappConfig, whatsappRoutingMode } from "@/lib/whatsapp/config";
import { saveInbound, saveStatus } from "@/lib/whatsapp/store";
import { resolveWhatsappCompanyByProviderPhone } from "@/lib/whatsapp/tenant-resolve";
import {
  routeWebhookEvents,
  signatureMatches,
  splitWebhook,
  verifyChallenge,
  WEBHOOK_HTTP,
  webhookHttpStatus,
} from "@/lib/whatsapp/webhook";

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
  if (!webhookReady(config)) return new Response("not configured", { status: WEBHOOK_HTTP.notConfigured });

  const raw = await request.text();
  if (!signatureMatches(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return new Response("invalid signature", { status: WEBHOOK_HTTP.invalidSignature });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: WEBHOOK_HTTP.badJson });
  }

  const admin = createAdminClient();
  if (!admin) return new Response("not configured", { status: WEBHOOK_HTTP.notConfigured });

  const { messages, statuses } = splitWebhook(payload);
  const mode = whatsappRoutingMode();

  const routed = await routeWebhookEvents({
    messages,
    statuses,
    mode,
    envCompanyId: config.companyId,
    envPhoneNumberId: config.phoneNumberId,
    resolve: async (phoneNumberId) => {
      const resolved = await resolveWhatsappCompanyByProviderPhone(admin, phoneNumberId);
      if (!resolved.ok) return { ok: false, code: resolved.code };
      return { ok: true, companyId: resolved.companyId };
    },
    saveInbound: (companyId, message) => saveInbound(admin, companyId, message),
    saveStatus: (companyId, status) => saveStatus(admin, companyId, status),
  });

  if (routed.retry) return new Response("store failed", { status: webhookHttpStatus(routed) });
  return new Response("ok", { status: webhookHttpStatus(routed) });
}

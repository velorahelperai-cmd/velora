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
  type WebhookRouteResult,
} from "@/lib/whatsapp/webhook";

export const runtime = "nodejs";

/** Limited diagnostics — no bodies, full phone numbers, wa ids, or secrets. */
function logWebhookDiag(
  stage: string,
  fields: Record<string, string | number | boolean | undefined>,
) {
  const safe = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
  console.info(JSON.stringify({ scope: "wa_webhook", stage, ...safe }));
}

function summarizeRoute(routed: WebhookRouteResult) {
  const counts = { persisted: 0, rejected: 0, retry: 0 };
  const codes: Record<string, number> = {};
  for (const d of routed.dispositions) {
    counts[d.result] += 1;
    const code = d.code ?? d.result;
    codes[code] = (codes[code] ?? 0) + 1;
  }
  return { ...counts, codes };
}

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
  if (!challenge) {
    logWebhookDiag("verify_reject", { ok: false });
    return new Response("forbidden", { status: 403 });
  }
  logWebhookDiag("verify_ok", { ok: true });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request) {
  const config = whatsappConfig();
  const mode = whatsappRoutingMode();
  if (!webhookReady(config)) {
    logWebhookDiag("post_not_configured", { mode, retry: true });
    return new Response("not configured", { status: WEBHOOK_HTTP.notConfigured });
  }

  const raw = await request.text();
  if (!signatureMatches(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    logWebhookDiag("post_bad_signature", { mode, bytes: raw.length });
    return new Response("invalid signature", { status: WEBHOOK_HTTP.invalidSignature });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    logWebhookDiag("post_bad_json", { mode, bytes: raw.length });
    return new Response("bad json", { status: WEBHOOK_HTTP.badJson });
  }

  const admin = createAdminClient();
  if (!admin) {
    logWebhookDiag("post_no_admin", { mode, retry: true });
    return new Response("not configured", { status: WEBHOOK_HTTP.notConfigured });
  }

  const { messages, statuses } = splitWebhook(payload);
  logWebhookDiag("post_parsed", {
    mode,
    messages: messages.length,
    statuses: statuses.length,
    bytes: raw.length,
  });

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

  const summary = summarizeRoute(routed);
  logWebhookDiag("post_routed", {
    mode,
    retry: routed.retry,
    persisted: summary.persisted,
    rejected: summary.rejected,
    retryEvents: summary.retry,
    codes: JSON.stringify(summary.codes),
  });

  if (routed.retry) return new Response("store failed", { status: webhookHttpStatus(routed) });
  return new Response("ok", { status: webhookHttpStatus(routed) });
}

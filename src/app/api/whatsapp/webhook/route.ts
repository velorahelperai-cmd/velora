import { createAdminClient } from "@/lib/supabase/admin";
import { observeWebhookIngress } from "@/lib/logging/ingress-observation-server";
import { webhookReady, whatsappConfig, whatsappRoutingMode } from "@/lib/whatsapp/config";
import { saveInbound, saveStatus } from "@/lib/whatsapp/store";
import { resolveWhatsappCompanyByMetaAsset } from "@/lib/whatsapp/tenant-resolve";
import {splitCoexistenceWebhook} from "@/lib/whatsapp/coexistence/webhook-events";
import {ingestCoexistenceWebhookEvent,type CoexistenceIngressClient} from "@/lib/whatsapp/coexistence/webhook-store";
import {recordCoexistenceOutboundProof} from "@/lib/whatsapp/coexistence/projection-store";
import {
  routeWebhookEvents,
  signatureMatches,
  splitWebhook,
  splitMetaAuthorizationRevocations,
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

const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
const assetKey=(wabaId:string,phoneId:string)=>JSON.stringify([wabaId,phoneId]);
/** Preserve the original signed change until its persisted connection mode is known. */
function liveChanges(payload:unknown){
 const changes:Array<{wabaId:string;phoneId:string;payload:unknown}>=[];
 const root=record(payload);if(root?.object!=="whatsapp_business_account")return changes;
 for(const raw of Array.isArray(root.entry)?root.entry:[]){const entry=record(raw);if(typeof entry?.id!=="string")continue;
  for(const rawChange of Array.isArray(entry.changes)?entry.changes:[]){const change=record(rawChange),value=record(change?.value),metadata=record(value?.metadata);
   if(change?.field!=="messages"||typeof metadata?.phone_number_id!=="string")continue;
   changes.push({wabaId:entry.id,phoneId:metadata.phone_number_id,payload:{object:"whatsapp_business_account",entry:[{...entry,changes:[rawChange]}]}});
  }
 }return changes;
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
  return observeWebhookIngress("whatsapp", () => handlePost(request));
}
async function handlePost(request: Request) {
  if (process.env.WHATSAPP_RECEIVE_ENABLED !== "true") {
    return new Response("receive disabled", { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } });
  }
  const config = whatsappConfig();
  const mode = whatsappRoutingMode();
  if (!webhookReady(config)) {
    logWebhookDiag("post_not_configured", { mode, retry: true });
    return new Response("not configured", { status: WEBHOOK_HTTP.notConfigured });
  }

  let raw: Uint8Array;
  try {
    raw = new Uint8Array(await request.arrayBuffer());
  } catch {
    logWebhookDiag("post_body_unavailable", { mode, retry: true });
    return new Response("body unavailable", { status: WEBHOOK_HTTP.retryable });
  }
  if (!signatureMatches(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    logWebhookDiag("post_bad_signature", { mode, bytes: raw.length });
    return new Response("invalid signature", { status: WEBHOOK_HTTP.invalidSignature });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    logWebhookDiag("post_bad_json", { mode, bytes: raw.length });
    return new Response("bad json", { status: WEBHOOK_HTTP.badJson });
  }

  const { messages, statuses } = splitWebhook(payload);
  const coexistence = mode === "tenant_registry" ? splitCoexistenceWebhook(payload) : {events:[],errors:[]};
  if(coexistence.errors.length)return new Response("invalid coexistence event",{status:WEBHOOK_HTTP.badJson});
  const revocations = mode === "tenant_registry" ? splitMetaAuthorizationRevocations(payload) : [];
  // Authentic unsupported event types have no storage dependency.
  if (!messages.length && !statuses.length && !revocations.length && !coexistence.events.length && !liveChanges(payload).length) return new Response("ok", { status: WEBHOOK_HTTP.completed });
  const admin = createAdminClient();
  if (!admin) {
    logWebhookDiag("post_no_admin", { mode, retry: true });
    return new Response("not configured", { status: WEBHOOK_HTTP.notConfigured });
  }

  let revocationRetry = false;
  for (const event of revocations) {
    try {
      const { data, error } = await admin.rpc("whatsapp_revoke_meta_waba_authorization", {
        p_waba_id: event.wabaId, p_reason: event.reason, p_occurred_at: event.occurredAt,
      });
      if (error || !data || typeof data !== "object" || Array.isArray(data) || data.ok !== true) revocationRetry = true;
    } catch {
      revocationRetry = true;
    }
  }
  if (revocationRetry) {
    logWebhookDiag("post_revocation_retry", { mode, retry: true });
    return new Response("store failed", { status: WEBHOOK_HTTP.retryable });
  }
  const resolvedAssets=new Map<string,Promise<Awaited<ReturnType<typeof resolveWhatsappCompanyByMetaAsset>>>>();
  function resolveAsset(wabaId:string,phoneId:string){
   const key=assetKey(wabaId,phoneId);let pending=resolvedAssets.get(key);
   if(!pending){pending=resolveWhatsappCompanyByMetaAsset(admin!,wabaId,phoneId).catch(()=>({ok:false as const,eligible:false as const,code:"unavailable" as const}));resolvedAssets.set(key,pending);}return pending;
  }
  const coexistenceAssets=new Set<string>();let coexistenceRetry=false;
  const ingressClient=admin as unknown as CoexistenceIngressClient;
  for(const event of coexistence.events){const receipt=await ingestCoexistenceWebhookEvent(ingressClient,event);if(!receipt.ok&&receipt.code==="INVALID_INPUT")return new Response("invalid coexistence event",{status:WEBHOOK_HTTP.badJson});if(!receipt.ok&&receipt.retry)coexistenceRetry=true;}
  if(mode==="tenant_registry")for(const change of liveChanges(payload)){
   const resolved=await resolveAsset(change.wabaId,change.phoneId);
   if((resolved.ok&&resolved.connectionMode==="coexistence")||(!resolved.ok&&resolved.pendingCoexistence===true)){
    coexistenceAssets.add(assetKey(change.wabaId,change.phoneId));
    const live=splitCoexistenceWebhook(change.payload,{includeLiveInbound:true});
    if(live.errors.length)return new Response("invalid coexistence event",{status:WEBHOOK_HTTP.badJson});
    for(const event of live.events){const receipt=await ingestCoexistenceWebhookEvent(ingressClient,event);if(!receipt.ok&&receipt.code==="INVALID_INPUT")return new Response("invalid coexistence event",{status:WEBHOOK_HTTP.badJson});if(!receipt.ok&&receipt.retry)coexistenceRetry=true;}
   }
  }
  logWebhookDiag("post_parsed", {
    mode,
    messages: messages.length,
    statuses: statuses.length,
    bytes: raw.length,
  });

  const routed = await routeWebhookEvents({
    messages:messages.filter(message=>!coexistenceAssets.has(assetKey(message.wabaId??"",message.phoneNumberId))),
    statuses,
    mode,
    envCompanyId: config.companyId,
    envPhoneNumberId: config.phoneNumberId,
    resolve: async (phoneNumberId, wabaId) => {
      const resolved = await resolveAsset(wabaId ?? "", phoneNumberId);
      if (!resolved.ok) return { ok: false, code: resolved.code };
      return { ok: true, companyId: resolved.companyId };
    },
    saveInbound: (companyId, message) => saveInbound(admin, companyId, message),
    saveStatus: async (companyId, status) => {
      const saved=await saveStatus(admin,companyId,status);
      if(mode==="tenant_registry"&&status.wabaId&&["delivered","read"].includes(status.status)){
        const binding=await resolveAsset(status.wabaId,status.phoneNumberId);
        if(binding.ok&&binding.companyId===companyId&&binding.connectionMode==="coexistence"){
          const proof=await recordCoexistenceOutboundProof(ingressClient,{companyId,linkId:binding.linkId,linkGeneration:binding.linkGeneration,wabaId:status.wabaId,phoneNumberId:status.phoneNumberId,waMessageId:status.waMessageId,status:status.status,recipientWaId:status.recipientWaId,occurredAt:status.occurredAt});
          if(!proof.ok&&proof.retry)throw new Error("coexistence_delivery_proof_unavailable");
        }
      }
      return saved;
    },
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

  if (routed.retry||coexistenceRetry) return new Response("store failed", { status: WEBHOOK_HTTP.retryable });
  return new Response("ok", { status: webhookHttpStatus(routed) });
}

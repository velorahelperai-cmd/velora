"use server";

import type { Conversation, ConversationStatus } from "@/lib/demo-state";
import type { Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "@/lib/tenancy/access";
import {
  sessionHasCompanyCapability,
} from "@/lib/access/actions";
import { controlActionCapability } from "@/lib/access/capabilities";
import { externalSendAllowed, sendReady, whatsappConfig, whatsappConfigurationMode, whatsappRoutingMode } from "@/lib/whatsapp/config";
import {readChannelReviewAccess} from '@/lib/meta-review/actions';
import {reviewDispatchCurrent,type ReviewGrant} from '@/lib/meta-review/access';
import { loadWhatsappConversation, loadWhatsappInbox, type WhatsappInboxMeta } from "@/lib/whatsapp/inbox";
import { sendWhatsappText } from "@/lib/whatsapp/send";
import { readServiceWindow } from "@/lib/whatsapp/service-window";
import { decideClaimedTenantSend, applyClaimedPreGraphOutcome } from "@/lib/whatsapp/send-attempt";
import { classifyPreGraphSettlement, replyFromPreGraphSettlement } from "@/lib/whatsapp/send-failure";
import {
  evaluateOutboundBinding,
  resolveWhatsappCompanyByProviderPhone,
} from "@/lib/whatsapp/tenant-resolve";

export type ControlAction = "take_over" | "resume" | "close" | "assign";

export type ControlState = {
  id: string;
  status: ConversationStatus;
  automationAllowed: boolean;
  automationGeneration: number;
  revision: number;
  assistantPaused: boolean;
  owner: "assistant" | "staff";
};

export type ControlActionResult =
  | { ok: true; state: ControlState }
  | {
    ok: false;
    code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT" | "UNAVAILABLE";
    state?: ControlState;
  };

export type ReplyActionResult =
  | {
      ok: true;
      message: {
        id: string;
        text: string;
        at: number;
        from: "staff";
        deliveryState?: "accepted" | "sent" | "delivered" | "read" | "failed";
      };
      outcome: "accepted";
      clientOpId: string;
    }
  | {
      ok: false;
      code:
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "SEND_DISABLED"
        | "NOT_CONFIGURED"
        | "NEEDS_SETUP"
        | "PHONE_MISMATCH"
        | "CONTENT_MISMATCH"
        | "COMPANY_SUSPENDED"
        | "SUBSCRIPTION_INACTIVE"
        | "IN_PROGRESS"
        | "REJECTED"
        | "UNKNOWN_OUTCOME"
        | "PERSIST_PENDING"
        | "INVALID_INPUT"
        | "GRAPH_ERROR"
        | "SAVE_FAILED";
      message: string;
      clientOpId?: string;
      outcome?: "ready" | "attempting" | "accepted" | "rejected" | "unknown";
      notAttempted?: true;
    };

type IntentPublic = {
  id: string;
  company_id: string;
  conversation_id: string;
  sender_kind: string;
  client_op_id: string;
  outcome: string;
  wa_message_id: string | null;
  message_id: string | null;
  body: string;
  phone_number_id: string;
  recipient_wa_id: string;
  link_id: string | null;
  link_generation: number | null;
};

function intentFrom(raw: unknown): IntentPublic | null {
  const row = asRecord(raw as Json);
  if (!row || ["id", "company_id", "conversation_id", "sender_kind", "client_op_id", "body", "phone_number_id", "recipient_wa_id"]
    .some((key) => typeof row[key] !== "string" || !(row[key] as string).trim())) return null;
  if (!["ready", "attempting", "accepted", "rejected", "unknown"].includes(String(row.outcome))) return null;
  const genRaw = row.link_generation;
  const linkGeneration = typeof genRaw === "number" ? genRaw
    : typeof genRaw === "string" && genRaw.trim() ? Number(genRaw) : null;
  return {
    id: row.id as string,
    company_id: row.company_id as string,
    conversation_id: row.conversation_id as string,
    sender_kind: row.sender_kind as string,
    client_op_id: String(row.client_op_id ?? ""),
    outcome: String(row.outcome ?? "ready"),
    wa_message_id: typeof row.wa_message_id === "string" ? row.wa_message_id : null,
    message_id: typeof row.message_id === "string" ? row.message_id : null,
    body: String(row.body ?? ""),
    phone_number_id: String(row.phone_number_id ?? ""),
    recipient_wa_id: String(row.recipient_wa_id ?? ""),
    link_id: typeof row.link_id === "string" ? row.link_id : null,
    link_generation: linkGeneration != null && Number.isSafeInteger(linkGeneration) && linkGeneration >= 1 ? linkGeneration : null,
  };
}

function messageFromFinal(raw: unknown): ReplyActionResult & { ok: true } | null {
  const row = asRecord(raw as Json);
  if (!row || typeof row.id !== "string") return null;
  const delivery =
    typeof row.delivery_state === "string" && row.delivery_state
      ? (row.delivery_state as "accepted" | "sent" | "delivered" | "read" | "failed")
      : "accepted";
  return {
    ok: true,
    outcome: "accepted",
    clientOpId: "",
    message: {
      id: row.id,
      text: String(row.body ?? ""),
      at: Date.parse(String(row.received_at ?? "")) || Date.now(),
      from: "staff",
      deliveryState: delivery,
    },
  };
}

/** Map retry_whatsapp_send_persist — provider_id_conflict becomes UNKNOWN, never PERSIST_PENDING. */
function mapRetryPersist(
  retried: { data: unknown; error: unknown },
  clientOpId: string,
): ReplyActionResult | null {
  const retryRow = asRecord(retried.data as Json);
  if (retried.error || !retryRow) return null;
  if (retryRow.ok === true) {
    const msg = messageFromFinal(retryRow.message);
    if (msg) return { ...msg, clientOpId };
    return {
      ok: false,
      code: "PERSIST_PENDING",
      message: "accepted_persist_pending",
      clientOpId,
      outcome: "accepted",
    };
  }
  const code = String(retryRow.code ?? "");
  if (code === "provider_id_conflict") {
    return {
      ok: false,
      code: "UNKNOWN_OUTCOME",
      message: "provider_id_conflict",
      clientOpId,
      outcome: "unknown",
    };
  }
  if (code === "persist_failed" || code === "not_persistable") {
    return {
      ok: false,
      code: "PERSIST_PENDING",
      message: code,
      clientOpId,
      outcome: "accepted",
    };
  }
  return null;
}

/**
 * Staff reply: durable intent → atomic claim (service) → provider call → explicit finalize (service).
 * Never auto-resends unknown/attempting outcomes. Does not trust browser company/phone.
 * attempt_token never leaves the server action.
 */
export async function replyWhatsappConversation(input: {
  conversationId: string;
  body: string;
  /** Stable per user send operation — retries with the same id return existing state. */
  clientOpId: string;
}): Promise<ReplyActionResult> {
  if (!input || typeof input.conversationId !== "string" || !input.conversationId.trim()
    || typeof input.body !== "string" || typeof input.clientOpId !== "string") {
    return { ok: false, code: "INVALID_INPUT", message: "invalid_input" };
  }
  const text = input.body.trim();
  const clientOpId = input.clientOpId.trim();
  if (!text || text.length > 4096 || clientOpId.length < 8 || clientOpId.length > 128) {
    return { ok: false, code: "INVALID_INPUT", message: "invalid_input" };
  }

  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNAUTHENTICATED" || access.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED", message: "sign_in_required", clientOpId };
    }
    return { ok: false, code: "FORBIDDEN", message: "forbidden", clientOpId };
  }
  if (!access.context.company || !access.context.membership || !access.context.userId) {
    return { ok: false, code: "FORBIDDEN", message: "forbidden", clientOpId };
  }
  if (access.context.company.status === "suspended") {
    return { ok: false, code: "COMPANY_SUSPENDED", message: "company_suspended", clientOpId };
  }
  if (!["owner", "staff"].includes(access.context.membership.role)) {
    return { ok: false, code: "FORBIDDEN", message: "forbidden", clientOpId };
  }

  const companyId = access.context.company.id;
  const actorUserId = access.context.userId;
  const canReply = await sessionHasCompanyCapability(companyId, "wa.conversations.reply");
  // Production mutations require an authoritative capability decision.
  if (canReply !== true) {
    return { ok: false, code: "FORBIDDEN", message: "capability_denied", clientOpId };
  }
  const canRead = await sessionHasCompanyCapability(companyId, "wa.conversations.read");
  if (canRead !== true) {
    return { ok: false, code: "FORBIDDEN", message: "capability_denied", clientOpId };
  }

  const mode = whatsappRoutingMode();
  const config = whatsappConfig();
  const reviewMode=whatsappConfigurationMode()==='meta_test';
  let reviewGrant:ReviewGrant|null=null;

  if (!externalSendAllowed()) {
    return { ok: false, code: "SEND_DISABLED", message: "external_send_disabled", clientOpId };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, code: "NOT_CONFIGURED", message: "admin_client_missing", clientOpId };
  }

  const convRead = await supabase
    .from("whatsapp_conversations")
    .select("id, company_id, phone_number_id, customer_wa_id")
    .eq("id", input.conversationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (convRead.error) {
    return { ok: false, code: "SAVE_FAILED", message: "conversation_unavailable", clientOpId };
  }
  if (!convRead.data) {
    return { ok: false, code: "NOT_FOUND", message: "not_found", clientOpId };
  }

  const conversationPhone = String(convRead.data.phone_number_id ?? "").trim();
  const recipientWaId = String(convRead.data.customer_wa_id ?? "").trim();
  if (!conversationPhone || !recipientWaId) {
    return { ok: false, code: "NOT_CONFIGURED", message: "conversation_phone_missing", clientOpId };
  }

  const conversationBind = {
    companyId: String(convRead.data.company_id),
    phoneNumberId: conversationPhone,
    customerWaId: recipientWaId,
  };

  let phoneNumberId = conversationPhone;
  let intentLinkId: string | null = null;
  let intentLinkGeneration: number | null = null;

  if (mode === "tenant_registry") {
    const resolved = await resolveWhatsappCompanyByProviderPhone(admin, conversationPhone);
    const bound = evaluateOutboundBinding({
      companyId,
      phoneNumberId: conversationPhone,
      recipientWaId,
      conversation: conversationBind,
      resolved,
    });
    if (!bound.ok) {
      if (bound.code === "company_suspended") {
        return { ok: false, code: "COMPANY_SUSPENDED", message: bound.code, clientOpId };
      }
      if (bound.code === "unavailable") {
        return { ok: false, code: "SAVE_FAILED", message: bound.code, clientOpId };
      }
      return { ok: false, code: "PHONE_MISMATCH", message: bound.code, clientOpId };
    }
    intentLinkId = bound.linkId;
    intentLinkGeneration = bound.linkGeneration;
    phoneNumberId = bound.providerPhoneNumberId;
  } else {
    if (!config.phoneNumberId) {
      return { ok: false, code: "NOT_CONFIGURED", message: "phone_not_configured", clientOpId };
    }
    if (config.companyId && config.companyId !== companyId) {
      return { ok: false, code: "FORBIDDEN", message: "company_mismatch", clientOpId };
    }
    if (conversationPhone !== config.phoneNumberId) {
      return { ok: false, code: "PHONE_MISMATCH", message: "phone_mismatch", clientOpId };
    }
    phoneNumberId = config.phoneNumberId;
  }

  const created = await supabase.rpc("create_whatsapp_send_intent", {
    p_client_op_id: clientOpId,
    p_conversation_id: input.conversationId,
    p_body: text,
    p_phone_number_id: phoneNumberId,
    p_sender_kind: "staff",
    p_expected_automation_generation: null,
    ...(mode === "tenant_registry"
      ? { p_link_id: intentLinkId, p_link_generation: intentLinkGeneration }
      : {}),
  });
  if (created.error) {
    return { ok: false, code: "SAVE_FAILED", message: "intent_unavailable", clientOpId };
  }
  const createdRow = asRecord(created.data);
  if (!createdRow) {
    return { ok: false, code: "SAVE_FAILED", message: "intent_unavailable", clientOpId };
  }
  if (createdRow.ok !== true) {
    const code = String(createdRow.code ?? "");
    if (code === "unauthenticated") return { ok: false, code: "UNAUTHENTICATED", message: code, clientOpId };
    if (code === "forbidden") return { ok: false, code: "FORBIDDEN", message: code, clientOpId };
    if (code === "not_found") return { ok: false, code: "NOT_FOUND", message: code, clientOpId };
    if (code === "company_suspended") return { ok: false, code: "COMPANY_SUSPENDED", message: code, clientOpId };
    if (code === "phone_mismatch") return { ok: false, code: "PHONE_MISMATCH", message: code, clientOpId };
    if (code === "content_mismatch") return { ok: false, code: "CONTENT_MISMATCH", message: code, clientOpId };
    if (code === "invalid_input") return { ok: false, code: "INVALID_INPUT", message: code, clientOpId };
    return { ok: false, code: "SAVE_FAILED", message: "intent_failed", clientOpId };
  }

  let intent = intentFrom(createdRow.intent);
  if (!intent) {
    return { ok: false, code: "SAVE_FAILED", message: "intent_missing", clientOpId };
  }
  const replyBindingMatches = (stored: IntentPublic) =>
    stored.company_id === companyId
    && stored.conversation_id === input.conversationId
    && stored.client_op_id === clientOpId
    && stored.sender_kind === "staff"
    && stored.phone_number_id === phoneNumberId
    && stored.recipient_wa_id === recipientWaId
    && stored.body === text;
  if (!replyBindingMatches(intent)) {
    return { ok: false, code: "CONTENT_MISMATCH", message: "intent_binding_mismatch", clientOpId };
  }

  // Idempotent settled paths — never start a new provider send.
  if (intent.outcome === "accepted") {
    if (intent.message_id) {
      const { data: msg } = await supabase
        .from("whatsapp_messages")
        .select("id, body, received_at, delivery_state")
        .eq("id", intent.message_id)
        .maybeSingle();
      if (msg) {
        return {
          ok: true,
          outcome: "accepted",
          clientOpId,
          message: {
            id: msg.id,
            text: msg.body,
            at: Date.parse(msg.received_at) || Date.now(),
            from: "staff",
            deliveryState: (msg.delivery_state as "accepted" | null) ?? "accepted",
          },
        };
      }
    }
    if (intent.wa_message_id) {
      const retried = await admin.rpc("retry_whatsapp_send_persist", {
        p_intent_id: intent.id,
        p_actor_user_id: actorUserId,
      });
      const mapped = mapRetryPersist(retried, clientOpId);
      if (mapped) return mapped;
      return {
        ok: false,
        code: "PERSIST_PENDING",
        message: "accepted_persist_pending",
        clientOpId,
        outcome: "accepted",
      };
    }
    // Accepted claimed without retained provider id — unresolved, keep op id.
    return { ok: false, code: "UNKNOWN_OUTCOME", message: "accepted_without_id", clientOpId, outcome: "unknown" };
  }
  if (intent.outcome === "rejected") {
    return { ok: false, code: "REJECTED", message: "previously_rejected", clientOpId, outcome: "rejected" };
  }
  if (intent.outcome === "unknown") {
    return { ok: false, code: "UNKNOWN_OUTCOME", message: "previously_unknown", clientOpId, outcome: "unknown" };
  }
  if (intent.outcome === "attempting") {
    return { ok: false, code: "IN_PROGRESS", message: "attempt_in_progress", clientOpId, outcome: "attempting" };
  }

  // Claim is service_role only — membership already verified above.
  const reviewAccess=reviewMode?await readChannelReviewAccess(companyId,'whatsapp'):null;
  reviewGrant=reviewAccess?.ok?reviewAccess.grant:null;
  // Another request may have claimed this same operation since the native read.
  // Retain its key until storage is refreshed; no local snapshot proves no attempt.
  if(reviewMode&&!reviewGrant)return {ok:false,code:'SAVE_FAILED',message:'review_access_unavailable',clientOpId};
  const claimed = reviewGrant ? await (admin as unknown as {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>}).rpc('claim_whatsapp_review_send',{
    p_intent_id:intent.id,p_actor_user_id:actorUserId,p_grant_id:reviewGrant.id,
  }) : await admin.rpc("claim_whatsapp_send_attempt", {
    p_intent_id: intent.id,
    p_actor_user_id: actorUserId,
    p_lease_seconds: 90,
  });
  if (claimed.error) {
    return { ok: false, code: "SAVE_FAILED", message: "claim_unavailable", clientOpId };
  }
  const claimRow = asRecord(claimed.data);
  if (!claimRow) {
    return { ok: false, code: "SAVE_FAILED", message: "claim_unavailable", clientOpId };
  }
  if (claimRow.ok === false && claimRow.code === "number_unconfirmed") {
    // F5: the owner has not confirmed this linked number; nothing was sent to Meta.
    return { ok: false, code: "SEND_DISABLED", message: "number_unconfirmed", clientOpId };
  }
  const claimedIntent = intentFrom(claimRow.intent);
  if (claimRow.ok === true && (
    !claimedIntent || claimedIntent.id !== intent.id || !replyBindingMatches(claimedIntent)
  )) {
    // No retained binding proof: preserve the operation, never contact Graph.
    return { ok: false, code: "UNKNOWN_OUTCOME", message: "claim_binding_unconfirmed", clientOpId, outcome: "unknown" };
  }
  if (claimRow.ok === true && claimRow.claimed === false) {
    intent = claimedIntent!;
    if (intent.outcome === "accepted" && intent.message_id) {
      const { data: msg } = await supabase
        .from("whatsapp_messages")
        .select("id, body, received_at, delivery_state")
        .eq("id", intent.message_id)
        .maybeSingle();
      if (msg) {
        return {
          ok: true,
          outcome: "accepted",
          clientOpId,
          message: {
            id: msg.id,
            text: msg.body,
            at: Date.parse(msg.received_at) || Date.now(),
            from: "staff",
            deliveryState: (msg.delivery_state as "accepted" | null) ?? "accepted",
          },
        };
      }
    }
    if (intent.outcome === "accepted" && intent.wa_message_id) {
      return {
        ok: false,
        code: "PERSIST_PENDING",
        message: "accepted_persist_pending",
        clientOpId,
        outcome: "accepted",
      };
    }
    if (intent.outcome === "unknown") {
      return { ok: false, code: "UNKNOWN_OUTCOME", message: "settled_unknown", clientOpId, outcome: "unknown" };
    }
    if (intent.outcome === "rejected") {
      return { ok: false, code: "REJECTED", message: "settled_rejected", clientOpId, outcome: "rejected" };
    }
  }
  if (claimRow.ok !== true) {
    const code = String(claimRow.code ?? "");
    if (code === "in_progress") {
      return { ok: false, code: "IN_PROGRESS", message: code, clientOpId, outcome: "attempting" };
    }
    if (code === "company_suspended") {
      return { ok: false, code: "COMPANY_SUSPENDED", message: code, clientOpId };
    }
    if (code === "subscription_inactive") {
      if(reviewMode)return {ok:false,code:'SAVE_FAILED',message:'review_access_unavailable',clientOpId};
      return { ok: false, code: "SUBSCRIPTION_INACTIVE", message: code, clientOpId, outcome: "ready", notAttempted: true };
    }
    if (code === "forbidden") return { ok: false, code: "FORBIDDEN", message: code, clientOpId };
    if (code === "binding_mismatch" || code === "phone_mismatch") {
      return { ok: false, code: "PHONE_MISMATCH", message: code, clientOpId };
    }
    return { ok: false, code: "SAVE_FAILED", message: "claim_failed", clientOpId };
  }
  if (claimRow.claimed !== true || claimedIntent?.outcome !== "attempting") {
    return { ok: false, code: "IN_PROGRESS", message: "claim_not_confirmed", clientOpId, outcome: "attempting" };
  }

  const attemptToken = typeof claimRow.attempt_token === "string"
    && claimRow.attempt_token.trim() === claimRow.attempt_token
    && claimRow.attempt_token.length > 0 ? claimRow.attempt_token : null;
  intent = claimedIntent;
  if (!attemptToken) {
    // Claim succeeded without token — treat as unresolved; keep client_op_id.
    return { ok: false, code: "UNKNOWN_OUTCOME", message: "claim_token_missing", clientOpId, outcome: "unknown" };
  }

  // From here: provider contact may have started — never drop clientOpId; never invent a new op.
  const callFinalize = async (result: "rejected" | "unknown" | "accepted", errorCode: string | null, waMessageId: string | null = null) => {
    try {
      return await admin.rpc("finalize_whatsapp_send_attempt", {
        p_intent_id: intent!.id,
        p_attempt_token: attemptToken,
        p_result: result,
        p_wa_message_id: waMessageId,
        p_error_code: errorCode,
        p_actor_user_id: actorUserId,
      });
    } catch {
      return { error: { message: "finalize_unavailable" }, data: null };
    }
  };

  const settlePreGraphRejected = async (errorCode: string) => {
    const rpc = await callFinalize("rejected", errorCode);
    return replyFromPreGraphSettlement(classifyPreGraphSettlement(rpc), clientOpId, errorCode);
  };
  const paidProof = asRecord(claimRow.manual_paid_entitlement);
  const paidEntitlementStillCurrent = () => reviewGrant
    ? reviewDispatchCurrent(claimRow.review_entitlement,reviewGrant,companyId,'whatsapp',intent!.phone_number_id)
    : paidProof?.company_id === companyId && paidProof.environment === "live"
    && typeof paidProof.plan_version_id === "string" && paidProof.plan_version_id.trim().length > 0
    && typeof paidProof.paid_through === "string" && Number.isFinite(Date.parse(paidProof.paid_through))
    && Date.parse(paidProof.paid_through) > Date.now();

  try {
    // An older database cannot authorize dispatch by omitting the paid claim attestation.
    if (!paidEntitlementStillCurrent()) return settlePreGraphRejected("paid_entitlement_unconfirmed");
    let graphToken: string | undefined;
    let serviceWindowExpiresAt: string | undefined;
    if (mode === "tenant_registry") {
      serviceWindowExpiresAt = await readServiceWindow(admin, { companyId, conversationId: intent.conversation_id,
        phoneNumberId: intent.phone_number_id, recipientWaId: intent.recipient_wa_id }) ?? undefined;
      if (!serviceWindowExpiresAt) return settlePreGraphRejected("service_window_closed");
      const resolved = await resolveWhatsappCompanyByProviderPhone(admin, intent.phone_number_id);
      const secretRpc = resolved.ok && intent.link_id && intent.link_generation != null
        ? await admin.rpc("whatsapp_read_link_access_secret", { p_company_id: companyId, p_link_id: intent.link_id,
          p_phone_number_id: intent.phone_number_id, p_link_generation: intent.link_generation }) : null;
      const tokenProof = secretRpc && !secretRpc.error ? asRecord(secretRpc.data) : null;
      const secret = tokenProof?.ok === true && tokenProof.company_id === companyId && tokenProof.link_id === intent.link_id
        && tokenProof.phone_number_id === intent.phone_number_id && tokenProof.link_generation === intent.link_generation
        && typeof tokenProof.access_token === "string" && tokenProof.access_token.trim()
        ? { ok: true as const, accessToken: tokenProof.access_token }
        : { ok: false as const, code: "NEEDS_SETUP" as const };
      const decision = decideClaimedTenantSend({
        companyId,
        phoneNumberId: intent.phone_number_id,
        recipientWaId: intent.recipient_wa_id,
        conversation: conversationBind,
        resolved,
        intentLinkId: intent.link_id,
        intentLinkGeneration: intent.link_generation,
        secret,
      });
      if (decision.action !== "graph") {
        return applyClaimedPreGraphOutcome({
          decision,
          clientOpId,
          finalize: async ({ result, errorCode }) => callFinalize(result, errorCode),
        });
      }
      graphToken = decision.accessToken;
    } else if (!sendReady(config)) {
      return settlePreGraphRejected("not_configured");
    }

    if (!paidEntitlementStillCurrent()) return settlePreGraphRejected("paid_entitlement_unconfirmed");
    // This session-bound, one-use database gate runs after all async preparation.
    // A transport error may hide a committed authorization: retain the attempt,
    // never retry the gate or call Graph, and never overwrite another send's evidence.
    let dispatchRpc;
    try {
      dispatchRpc = reviewGrant ? await (supabase as unknown as {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>}).rpc('whatsapp_authorize_review_dispatch',{
        p_intent_id:intent.id,p_attempt_token:attemptToken,p_grant_id:reviewGrant.id,
      }) : await supabase.rpc("whatsapp_authorize_staff_dispatch", {
        p_intent_id: intent.id,
        p_attempt_token: attemptToken,
      });
    } catch {
      return { ok: false, code: "UNKNOWN_OUTCOME", message: "dispatch_authority_unconfirmed", clientOpId, outcome: "unknown" };
    }
    const dispatch = asRecord(dispatchRpc.data);
    if (dispatchRpc.error || !dispatch) {
      return { ok: false, code: "UNKNOWN_OUTCOME", message: "dispatch_authority_unconfirmed", clientOpId, outcome: "unknown" };
    }
    if (dispatch.ok !== true || dispatch.authorized !== true || dispatch.intent_id !== intent.id) {
      const denial = String(dispatch.code ?? "");
      const definitiveDenials = ["dispatch_binding_mismatch", "staff_authority_revoked", "staff_authority_expired",
        "paid_entitlement_unconfirmed", "link_changed", "service_window_closed", "dispatch_authority_busy", "forbidden"];
      if (dispatch.ok === false && definitiveDenials.includes(denial)) return settlePreGraphRejected(denial);
      return { ok: false, code: "UNKNOWN_OUTCOME", message: "dispatch_authority_unconfirmed", clientOpId, outcome: "unknown" };
    }
    if(reviewGrant&&(typeof dispatch.not_after!=='string'||!Number.isFinite(Date.parse(dispatch.not_after))||Date.parse(dispatch.not_after)<=Date.now()))return settlePreGraphRejected('staff_authority_expired');
    const sent = await sendWhatsappText({
      toWaId: intent.recipient_wa_id,
      body: intent.body,
      phoneNumberId: intent.phone_number_id,
      accessToken: graphToken,
      serviceWindowExpiresAt,
    });

    if (!sent.ok) {
      if (
        sent.code === "SEND_DISABLED"
        || sent.code === "NOT_CONFIGURED"
        || sent.code === "NEEDS_SETUP"
        || sent.code === "PHONE_MISMATCH"
        || sent.code === "RECIPIENT_NOT_ALLOWED"
        || sent.code === "SERVICE_WINDOW_CLOSED"
      ) {
        return settlePreGraphRejected(sent.code.toLowerCase());
      }
      if (sent.code === "GRAPH_REJECTED") {
        const rpc = await callFinalize("rejected", sent.detail || "graph_rejected");
        const settlement = classifyPreGraphSettlement(rpc);
        if (settlement.status === "keep_lock" || settlement.status === "keep_original") {
          return replyFromPreGraphSettlement(settlement, clientOpId, sent.detail || "graph_rejected");
        }
        return { ok: false, code: "REJECTED", message: sent.detail || "graph_rejected", clientOpId, outcome: "rejected" };
      }
      await callFinalize("unknown", sent.detail || "ambiguous");
      return { ok: false, code: "UNKNOWN_OUTCOME", message: sent.detail || "ambiguous", clientOpId, outcome: "unknown" };
    }

    const finalized = await callFinalize("accepted", null, sent.waMessageId);

    if (finalized.error) {
      // Provider accepted; retry finalize/persist only — never Graph. Keep client_op_id.
      const again = await callFinalize("accepted", null, sent.waMessageId);
      const againRow = asRecord(again.data);
      if (!again.error && againRow?.ok === true) {
        if (againRow.persist_pending === true) {
          const retried = await admin.rpc("retry_whatsapp_send_persist", {
            p_intent_id: intent.id,
            p_actor_user_id: actorUserId,
          });
          const mapped = mapRetryPersist(retried, clientOpId);
          if (mapped) return mapped;
          return {
            ok: false,
            code: "PERSIST_PENDING",
            message: "accepted_persist_pending",
            clientOpId,
            outcome: "accepted",
          };
        }
        const msg = messageFromFinal(againRow.message);
        if (msg) return { ...msg, clientOpId };
      }
      // Could not retain/confirm acceptance evidence → unresolved, keep op id.
      return {
        ok: false,
        code: "UNKNOWN_OUTCOME",
        message: "accept_evidence_unconfirmed",
        clientOpId,
        outcome: "unknown",
      };
    }

    const finalRow = asRecord(finalized.data);
    if (finalRow?.ok === false) {
      const code = String(finalRow.code ?? "");
      if (code === "provider_id_conflict" || code === "accept_evidence_lost") {
        return { ok: false, code: "UNKNOWN_OUTCOME", message: code, clientOpId, outcome: "unknown" };
      }
      return { ok: false, code: "SAVE_FAILED", message: "finalize_failed", clientOpId, outcome: "unknown" };
    }
    if (finalRow?.ok === true && finalRow.persist_pending === true) {
      const retried = await admin.rpc("retry_whatsapp_send_persist", {
        p_intent_id: intent.id,
        p_actor_user_id: actorUserId,
      });
      const mapped = mapRetryPersist(retried, clientOpId);
      if (mapped) return mapped;
      return {
        ok: false,
        code: "PERSIST_PENDING",
        message: "accepted_persist_pending",
        clientOpId,
        outcome: "accepted",
      };
    }
    if (finalRow?.ok === true) {
      const msg = messageFromFinal(finalRow.message);
      if (msg) return { ...msg, clientOpId };
      if (intent.wa_message_id || typeof (asRecord(finalRow.intent as Json)?.wa_message_id) === "string") {
        return {
          ok: false,
          code: "PERSIST_PENDING",
          message: "accepted_persist_pending",
          clientOpId,
          outcome: "accepted",
        };
      }
    }

    return { ok: false, code: "SAVE_FAILED", message: "finalize_failed", clientOpId, outcome: "unknown" };
  } catch {
    try {
      await callFinalize("unknown", "action_exception");
    } catch {
      // ignore secondary failure
    }
    return { ok: false, code: "UNKNOWN_OUTCOME", message: "action_exception", clientOpId, outcome: "unknown" };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapControlState(raw: Record<string, unknown> | null | undefined): ControlState | null {
  if (!raw || typeof raw.id !== "string") return null;
  const statusRaw = String(raw.status ?? "open");
  const status: ConversationStatus =
    statusRaw === "resolved" ? "resolved" : statusRaw === "handed_over" ? "handed_over" : "open";
  const automationAllowed = Boolean(raw.automation_allowed);
  return {
    id: raw.id,
    status,
    automationAllowed,
    automationGeneration: Number(raw.automation_generation ?? 0),
    revision: Number(raw.control_revision ?? 1),
    assistantPaused: !automationAllowed,
    owner: automationAllowed ? "assistant" : "staff",
  };
}

export async function controlWhatsappConversation(input: {
  conversationId: string;
  action: ControlAction;
  expectedRevision: number;
  assigneeUserId?: string | null;
}): Promise<ControlActionResult> {
  if (!input || typeof input.conversationId !== "string" || !input.conversationId.trim()
    || !["take_over", "resume", "close", "assign"].includes(input.action)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNAUTHENTICATED" || access.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (access.code === "UNAVAILABLE") {
      return { ok: false, code: "UNAVAILABLE" };
    }
    return { ok: false, code: "FORBIDDEN" };
  }
  if (!access.context.company || !access.context.membership) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (access.context.company.status === "suspended") {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (!["owner", "staff"].includes(access.context.membership.role)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const companyId = access.context.company.id;
  const needed = controlActionCapability(input.action);
  const canRead = await sessionHasCompanyCapability(companyId, "wa.conversations.read");
  if (canRead !== true) return { ok: false, code: "FORBIDDEN" };
  const canAct = await sessionHasCompanyCapability(companyId, needed);
  if (canAct !== true) return { ok: false, code: "FORBIDDEN" };

  if (!input.conversationId || !Number.isFinite(input.expectedRevision)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (input.action === "assign" && input.assigneeUserId === undefined) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  try {
    const supabase = await createClient();
    // A user may belong to several companies. A stale tab must not control a
    // different company's conversation through the currently selected workspace.
    const binding = await supabase.from("whatsapp_conversations").select("id")
      .eq("id", input.conversationId).eq("company_id", companyId).maybeSingle();
    if (binding.error) return { ok: false, code: "UNAVAILABLE" };
    if (!binding.data) return { ok: false, code: "NOT_FOUND" };
    const { data, error } = await supabase.rpc("control_whatsapp_conversation", {
      p_conversation_id: input.conversationId,
      p_action: input.action,
      p_expected_revision: input.expectedRevision,
      p_assignee_user_id: input.action === "assign" ? (input.assigneeUserId ?? null) : null,
    });
    if (error) return { ok: false, code: "UNAVAILABLE" };

    const row = asRecord(data);
    if (!row) return { ok: false, code: "UNAVAILABLE" };

    if (row.ok === true) {
      const state = mapControlState(asRecord(row.conversation as Json));
      if (!state) return { ok: false, code: "UNAVAILABLE" };
      return { ok: true, state };
    }

    const code = String(row.code ?? "unavailable");
    const state = mapControlState(asRecord(row.conversation as Json)) ?? undefined;
    if (code === "conflict") return { ok: false, code: "CONFLICT", state };
    if (code === "forbidden") return { ok: false, code: "FORBIDDEN", state };
    if (code === "not_found") return { ok: false, code: "NOT_FOUND" };
    if (code === "unauthenticated") return { ok: false, code: "UNAUTHENTICATED" };
    if (code === "invalid_input") return { ok: false, code: "INVALID_INPUT" };
    return { ok: false, code: "UNAVAILABLE", state };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/** Re-read one conversation after a successful control save (does not repeat the control action). */
export async function refreshWhatsappConversation(
  conversationId: string,
): Promise<{ ok: true; conversation: Conversation } | { ok: false; code: "NOT_FOUND" | "UNAVAILABLE" }> {
  try {
    const conversation = await loadWhatsappConversation(conversationId);
    if (!conversation) return { ok: false, code: "NOT_FOUND" };
    return { ok: true, conversation };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/** Re-read inbox + lead counts from the same product load path (no save). Full scope snapshot. */
export async function refreshWhatsappInboxSnapshot(): Promise<
  | {
      ok: true;
      kind: "full";
      conversations: Conversation[];
      meta: WhatsappInboxMeta;
    }
  | { ok: false; code: "NO_COMPANY" | "UNAVAILABLE" }
> {
  try {
    const loaded = await loadWhatsappInbox();
    if (!loaded.ok) return { ok: false, code: loaded.code };
    return {
      ok: true,
      kind: "full",
      conversations: loaded.conversations,
      meta: loaded.meta,
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export type LeadState = {
  id: string;
  leadStage: string;
  leadStageReason: string;
  internalNote: string;
  followUpStatus: string;
  followUpAt: string | null;
  lastTouchAt: string | null;
  leadRevision: number;
  assignedTo: string | null;
  controlRevision: number;
};

export type LeadSaveResult =
  | { ok: true; state: LeadState }
  | {
      ok: false;
      code:
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "CONFLICT"
        | "INVALID_INPUT"
        | "REASON_REQUIRED"
        | "FOLLOW_UP_AT_REQUIRED"
        | "SUBSCRIBED_FORBIDDEN"
        | "UNAVAILABLE";
      state?: LeadState;
    };

function mapLeadState(raw: Record<string, unknown> | null | undefined): LeadState | null {
  if (!raw || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    leadStage: String(raw.lead_stage ?? "new"),
    leadStageReason: String(raw.lead_stage_reason ?? ""),
    internalNote: String(raw.internal_note ?? ""),
    followUpStatus: String(raw.follow_up_status ?? "none"),
    followUpAt: typeof raw.follow_up_at === "string" ? raw.follow_up_at : null,
    lastTouchAt: typeof raw.last_touch_at === "string" ? raw.last_touch_at : null,
    leadRevision: Number(raw.lead_revision ?? 1),
    assignedTo: typeof raw.assigned_to === "string" ? raw.assigned_to : null,
    controlRevision: Number(raw.control_revision ?? 1),
  };
}

/**
 * Save lead stage / note / follow-up. Requires read+reply.
 * Never writes assigned_to (use control assign + control_revision).
 */
export async function upsertConversationLeadState(input: {
  conversationId: string;
  expectedLeadRevision: number;
  leadStage: string;
  leadStageReason: string;
  internalNote: string;
  followUpStatus: string;
  followUpAt: string | null;
}): Promise<LeadSaveResult> {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNAUTHENTICATED" || access.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (access.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE" };
    return { ok: false, code: "FORBIDDEN" };
  }
  if (!access.context.company || !access.context.membership) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (access.context.company.status === "suspended") {
    return { ok: false, code: "FORBIDDEN" };
  }

  const companyId = access.context.company.id;
  const canRead = await sessionHasCompanyCapability(companyId, "wa.conversations.read");
  if (canRead !== true) return { ok: false, code: "FORBIDDEN" };
  const canReply = await sessionHasCompanyCapability(companyId, "wa.conversations.reply");
  if (canReply !== true) return { ok: false, code: "FORBIDDEN" };

  if (!input.conversationId || !Number.isFinite(input.expectedLeadRevision)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (input.leadStage.trim().toLowerCase() === "subscribed") {
    return { ok: false, code: "SUBSCRIBED_FORBIDDEN" };
  }

  try {
    const supabase = await createClient();
    const binding = await supabase.from("whatsapp_conversations").select("id")
      .eq("id", input.conversationId).eq("company_id", companyId).maybeSingle();
    if (binding.error) return { ok: false, code: "UNAVAILABLE" };
    if (!binding.data) return { ok: false, code: "NOT_FOUND" };
    const { data, error } = await supabase.rpc("upsert_conversation_lead_state", {
      p_conversation_id: input.conversationId,
      p_expected_revision: input.expectedLeadRevision,
      p_lead_stage: input.leadStage,
      p_lead_stage_reason: input.leadStageReason,
      p_internal_note: input.internalNote,
      p_follow_up_status: input.followUpStatus,
      p_follow_up_at: input.followUpAt,
    });
    if (error) {
      // Missing RPC / ACCESS helpers → fail closed, no capability bypass.
      return { ok: false, code: "UNAVAILABLE" };
    }

    const row = asRecord(data);
    if (!row) return { ok: false, code: "UNAVAILABLE" };

    if (row.ok === true) {
      const state = mapLeadState(asRecord(row.conversation as Json));
      if (!state) return { ok: false, code: "UNAVAILABLE" };
      return { ok: true, state };
    }

    const code = String(row.code ?? "unavailable");
    const state = mapLeadState(asRecord(row.conversation as Json)) ?? undefined;
    if (code === "conflict") return { ok: false, code: "CONFLICT", state };
    if (code === "forbidden") return { ok: false, code: "FORBIDDEN", state };
    if (code === "not_found") return { ok: false, code: "NOT_FOUND" };
    if (code === "unauthenticated") return { ok: false, code: "UNAUTHENTICATED" };
    if (code === "subscribed_forbidden") return { ok: false, code: "SUBSCRIBED_FORBIDDEN" };
    if (code === "reason_required") return { ok: false, code: "REASON_REQUIRED" };
    if (code === "follow_up_at_required") return { ok: false, code: "FOLLOW_UP_AT_REQUIRED" };
    if (code === "invalid_input") return { ok: false, code: "INVALID_INPUT" };
    return { ok: false, code: "UNAVAILABLE", state };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

"use server";

import type { Conversation, ConversationStatus } from "@/lib/demo-state";
import type { Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { externalSendAllowed, sendReady, whatsappConfig, whatsappRoutingMode } from "@/lib/whatsapp/config";
import { loadWhatsappConversation } from "@/lib/whatsapp/inbox";
import { sendWhatsappText } from "@/lib/whatsapp/send";
import { decideClaimedTenantSend, applyClaimedPreGraphOutcome } from "@/lib/whatsapp/send-attempt";
import { classifyPreGraphSettlement, replyFromPreGraphSettlement } from "@/lib/whatsapp/send-failure";
import {
  evaluateOutboundBinding,
  resolveWhatsappCompanyByProviderPhone,
} from "@/lib/whatsapp/tenant-resolve";

export type ControlAction = "take_over" | "resume" | "close";

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
  if (!row || typeof row.id !== "string") return null;
  const genRaw = row.link_generation;
  const linkGeneration = typeof genRaw === "number" ? genRaw
    : typeof genRaw === "string" && genRaw.trim() ? Number(genRaw) : null;
  return {
    id: row.id,
    client_op_id: String(row.client_op_id ?? ""),
    outcome: String(row.outcome ?? "ready"),
    wa_message_id: typeof row.wa_message_id === "string" ? row.wa_message_id : null,
    message_id: typeof row.message_id === "string" ? row.message_id : null,
    body: String(row.body ?? ""),
    phone_number_id: String(row.phone_number_id ?? ""),
    recipient_wa_id: String(row.recipient_wa_id ?? ""),
    link_id: typeof row.link_id === "string" ? row.link_id : null,
    link_generation: linkGeneration != null && Number.isFinite(linkGeneration) ? linkGeneration : null,
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
  const text = input.body.trim().slice(0, 4096);
  const clientOpId = input.clientOpId.trim().slice(0, 128);
  if (!text || clientOpId.length < 8) {
    return { ok: false, code: "INVALID_INPUT", message: "invalid_input", clientOpId: input.clientOpId?.trim() || undefined };
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
  const mode = whatsappRoutingMode();
  const config = whatsappConfig();

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
    return { ok: false, code: "SAVE_FAILED", message: code || "intent_failed", clientOpId };
  }

  let intent = intentFrom(createdRow.intent);
  if (!intent) {
    return { ok: false, code: "SAVE_FAILED", message: "intent_missing", clientOpId };
  }
  if (intent.link_id) {
    intentLinkId = intent.link_id;
    intentLinkGeneration = intent.link_generation;
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
  const claimed = await admin.rpc("claim_whatsapp_send_attempt", {
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
  if (claimRow.ok === true && claimRow.claimed === false) {
    intent = intentFrom(claimRow.intent) ?? intent;
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
    if (code === "forbidden") return { ok: false, code: "FORBIDDEN", message: code, clientOpId };
    if (code === "binding_mismatch" || code === "phone_mismatch") {
      return { ok: false, code: "PHONE_MISMATCH", message: code, clientOpId };
    }
    return { ok: false, code: "SAVE_FAILED", message: code || "claim_failed", clientOpId };
  }

  const attemptToken = typeof claimRow.attempt_token === "string" ? claimRow.attempt_token : null;
  intent = intentFrom(claimRow.intent) ?? intent;
  if (!attemptToken) {
    // Claim succeeded without token — treat as unresolved; keep client_op_id.
    return { ok: false, code: "UNKNOWN_OUTCOME", message: "claim_token_missing", clientOpId, outcome: "unknown" };
  }

  // From here: provider contact may have started — never drop clientOpId; never invent a new op.
  const callFinalize = (result: "rejected" | "unknown" | "accepted", errorCode: string | null, waMessageId: string | null = null) =>
    admin.rpc("finalize_whatsapp_send_attempt", {
      p_intent_id: intent!.id,
      p_attempt_token: attemptToken,
      p_result: result,
      p_wa_message_id: waMessageId,
      p_error_code: errorCode,
      p_actor_user_id: actorUserId,
    });

  const settlePreGraphRejected = async (errorCode: string) => {
    const rpc = await callFinalize("rejected", errorCode);
    return replyFromPreGraphSettlement(classifyPreGraphSettlement(rpc), clientOpId, errorCode);
  };

  try {
    let graphToken: string | undefined;
    if (mode === "tenant_registry") {
      const resolved = await resolveWhatsappCompanyByProviderPhone(admin, intent.phone_number_id);
      const decision = decideClaimedTenantSend({
        companyId,
        phoneNumberId: intent.phone_number_id,
        recipientWaId: intent.recipient_wa_id,
        conversation: conversationBind,
        resolved,
        intentLinkId: intent.link_id ?? intentLinkId,
        intentLinkGeneration: intent.link_generation ?? intentLinkGeneration,
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

    const sent = await sendWhatsappText({
      toWaId: intent.recipient_wa_id,
      body: intent.body,
      phoneNumberId: intent.phone_number_id,
      accessToken: graphToken,
    });

    if (!sent.ok) {
      if (
        sent.code === "SEND_DISABLED"
        || sent.code === "NOT_CONFIGURED"
        || sent.code === "NEEDS_SETUP"
        || sent.code === "PHONE_MISMATCH"
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

    const finalized = await admin.rpc("finalize_whatsapp_send_attempt", {
      p_intent_id: intent.id,
      p_attempt_token: attemptToken,
      p_result: "accepted",
      p_wa_message_id: sent.waMessageId,
      p_error_code: null,
      p_actor_user_id: actorUserId,
    });

    if (finalized.error) {
      // Provider accepted; retry finalize/persist only — never Graph. Keep client_op_id.
      const again = await admin.rpc("finalize_whatsapp_send_attempt", {
        p_intent_id: intent.id,
        p_attempt_token: attemptToken,
        p_result: "accepted",
        p_wa_message_id: sent.waMessageId,
        p_error_code: null,
        p_actor_user_id: actorUserId,
      });
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
      return { ok: false, code: "SAVE_FAILED", message: code || "finalize_failed", clientOpId, outcome: "unknown" };
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

function asRecord(value: Json | null | undefined): Record<string, unknown> | null {
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
}): Promise<ControlActionResult> {
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
  if (!input.conversationId || !Number.isFinite(input.expectedRevision)) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("control_whatsapp_conversation", {
      p_conversation_id: input.conversationId,
      p_action: input.action,
      p_expected_revision: input.expectedRevision,
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

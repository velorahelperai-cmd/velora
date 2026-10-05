"use server";

import type { Conversation, ConversationStatus } from "@/lib/demo-state";
import type { Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { externalSendAllowed, whatsappConfig } from "@/lib/whatsapp/config";
import { loadWhatsappConversation } from "@/lib/whatsapp/inbox";
import { sendWhatsappText } from "@/lib/whatsapp/send";
import { saveOutbound } from "@/lib/whatsapp/store";

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
      message: { id: string; text: string; at: number; from: "staff" };
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "SEND_DISABLED" | "NOT_CONFIGURED" | "GRAPH_ERROR" | "SAVE_FAILED";
      message: string;
    };

export async function replyWhatsappConversation(input: {
  conversationId: string;
  body: string;
}): Promise<ReplyActionResult> {
  const text = input.body.trim().slice(0, 4096);
  if (!text) return { ok: false, code: "GRAPH_ERROR", message: "empty" };

  const access = await getCompanyAccess();
  if (!access.ok || !access.context.company) {
    return { ok: false, code: "UNAUTHENTICATED", message: "sign_in_required" };
  }

  const companyId = access.context.company.id;
  const supabase = await createClient();
  const { data: conversation, error } = await supabase
    .from("whatsapp_conversations")
    .select("id, company_id, customer_wa_id")
    .eq("id", input.conversationId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !conversation) {
    return { ok: false, code: "NOT_FOUND", message: "conversation_not_found" };
  }

  const config = whatsappConfig();
  if (config.companyId && config.companyId !== companyId) {
    return { ok: false, code: "FORBIDDEN", message: "company_mismatch" };
  }

  if (!externalSendAllowed()) {
    return {
      ok: false,
      code: "SEND_DISABLED",
      message: "external_send_disabled",
    };
  }

  const sent = await sendWhatsappText({
    toWaId: conversation.customer_wa_id,
    body: text,
  });
  if (!sent.ok) {
    return {
      ok: false,
      code: sent.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : sent.code === "SEND_DISABLED" ? "SEND_DISABLED" : "GRAPH_ERROR",
      message: sent.detail || sent.code.toLowerCase(),
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, code: "NOT_CONFIGURED", message: "admin_client_missing" };
  }

  try {
    const saved = await saveOutbound(admin, {
      companyId,
      conversationId: conversation.id,
      waMessageId: sent.waMessageId,
      body: text,
    });
    if (!saved.row) {
      return { ok: false, code: "SAVE_FAILED", message: "duplicate_or_missing_row" };
    }
    return {
      ok: true,
      message: {
        id: saved.row.id,
        text: saved.row.body,
        at: Date.parse(saved.row.received_at),
        from: "staff",
      },
    };
  } catch {
    return { ok: false, code: "SAVE_FAILED", message: "persist_failed" };
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

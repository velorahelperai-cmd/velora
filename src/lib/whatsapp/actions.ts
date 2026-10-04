"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { externalSendAllowed, whatsappConfig } from "@/lib/whatsapp/config";
import { sendWhatsappText } from "@/lib/whatsapp/send";
import { saveOutbound } from "@/lib/whatsapp/store";

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

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

export type AutomationGate = {
  ok: true;
  conversationId: string;
  companyId: string;
  status: string;
  automationAllowed: boolean;
  automationGeneration: number;
  controlRevision: number;
  companyStatus: string;
  /**
   * Permission snapshot for future automation only.
   * Not a live provider switch and not an atomic guarantee to send a message.
   */
  eligible: boolean;
};

export type AutomationGateFailure = {
  ok: false;
  code: string;
  eligible: false;
};

/**
 * Server-side reusable check for automation permission + generation + company status.
 * Call with service-role client from internal workers — not wired to a provider here.
 */
export async function fetchWhatsappAutomationGate(
  admin: SupabaseClient<Database>,
  conversationId: string,
): Promise<AutomationGate | AutomationGateFailure> {
  try {
    const { data, error } = await admin.rpc("whatsapp_automation_gate", {
      p_conversation_id: conversationId,
    });
    if (error) return { ok: false, code: "unavailable", eligible: false };

    const row = data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, Json>)
      : null;
    if (!row) return { ok: false, code: "unavailable", eligible: false };

    if (row.ok !== true) {
      return {
        ok: false,
        code: String(row.code ?? "not_found"),
        eligible: false,
      };
    }

    return {
      ok: true,
      conversationId: String(row.conversation_id ?? ""),
      companyId: String(row.company_id ?? ""),
      status: String(row.status ?? ""),
      automationAllowed: Boolean(row.automation_allowed),
      automationGeneration: Number(row.automation_generation ?? 0),
      controlRevision: Number(row.control_revision ?? 1),
      companyStatus: String(row.company_status ?? ""),
      eligible: Boolean(row.eligible),
    };
  } catch {
    return { ok: false, code: "unavailable", eligible: false };
  }
}

/**
 * Staged automated results require a successful gate, eligibility, and matching generation.
 * Does not and cannot cancel a provider message that was already accepted.
 */
export function automationResultStillValid(
  gate: AutomationGate | AutomationGateFailure,
  stagedGeneration: number,
) {
  if (!gate.ok || !gate.eligible) return false;
  return gate.automationGeneration === stagedGeneration;
}

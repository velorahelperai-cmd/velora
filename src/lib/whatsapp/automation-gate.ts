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
  /** True only when conversation permits future automation (not a live provider switch). */
  eligible: boolean;
};

/**
 * Server-side reusable check for automation permission + generation.
 * Call with service-role client from internal workers — not wired to a provider here.
 */
export async function fetchWhatsappAutomationGate(
  admin: SupabaseClient<Database>,
  conversationId: string,
): Promise<AutomationGate | { ok: false; code: string }> {
  const { data, error } = await admin.rpc("whatsapp_automation_gate", {
    p_conversation_id: conversationId,
  });
  if (error) return { ok: false, code: "unavailable" };
  const row = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, Json>) : null;
  if (!row || row.ok !== true) {
    return { ok: false, code: String(row?.code ?? "not_found") };
  }
  return {
    ok: true,
    conversationId: String(row.conversation_id ?? ""),
    companyId: String(row.company_id ?? ""),
    status: String(row.status ?? ""),
    automationAllowed: Boolean(row.automation_allowed),
    automationGeneration: Number(row.automation_generation ?? 0),
    controlRevision: Number(row.control_revision ?? 1),
    eligible: Boolean(row.eligible),
  };
}

/** Compare a staged automated result against the current gate (generation must match). */
export function automationResultStillValid(
  gate: AutomationGate,
  stagedGeneration: number,
) {
  return gate.eligible && gate.automationGeneration === stagedGeneration;
}

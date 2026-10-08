import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { automationResultStillValid, fetchWhatsappAutomationGate, type AutomationGate } from "./automation-gate";

const row = { ok: true, conversation_id: "conversation-fixture", company_id: "company-fixture", status: "open", automation_allowed: true, automation_generation: 0, control_revision: 1, company_status: "active", eligible: true };
function admin(data: unknown) { return { rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient<Database>; }
const gate: AutomationGate = { ok: true, conversationId: row.conversation_id, companyId: row.company_id, status: "open", automationAllowed: true, automationGeneration: 0, controlRevision: 1, companyStatus: "active", eligible: true };

describe("P4 human handoff gate", () => {
  it("accepts complete current open state including generation zero", async () => {
    expect(await fetchWhatsappAutomationGate(admin(row), row.conversation_id)).toEqual(gate);
  });
  it.each([
    { automation_allowed: "false" }, { eligible: "false" }, { automation_generation: 0.5 },
    { control_revision: 0 }, { company_id: " " }, { conversation_id: "other-conversation" },
  ])("fails closed on malformed gate %j", async patch => {
    expect(await fetchWhatsappAutomationGate(admin({ ...row, ...patch }), row.conversation_id)).toMatchObject({ ok: false, eligible: false });
  });
  it.each([{ status: "handed_over" }, { status: "resolved" }, { automation_allowed: false }, { company_status: "suspended" }])("does not trust contradictory eligible=true %j", async patch => {
    const result = await fetchWhatsappAutomationGate(admin({ ...row, ...patch }), row.conversation_id);
    expect(automationResultStillValid(result, 0)).toBe(false);
  });
  it.each([{ status: "handed_over" }, { automationAllowed: false }, { companyStatus: "suspended" }])("rejects a stale result during employee control %j", patch => {
    expect(automationResultStillValid({ ...gate, ...patch }, 0)).toBe(false);
  });
  it("rejects changed generation after answer preparation", () => {
    expect(automationResultStillValid({ ...gate, automationGeneration: 1 }, 0)).toBe(false);
  });
});

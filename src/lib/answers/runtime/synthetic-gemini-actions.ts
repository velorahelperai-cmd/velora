"use server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVerifiedUser } from "@/lib/tenancy/access";
import { executeSyntheticGemini } from "./synthetic-gemini";
import { isSyntheticUuid, readSyntheticGeminiConfig } from "./synthetic-gemini-config";
import type { SyntheticGeminiFreeState } from "./synthetic-gemini-types";

async function ownerGate() {
 const gate = await requireVerifiedUser();
 if (!gate.ok) return { ok: false as const, error: gate.code };
 const client = await createClient(); const owner = await client.rpc("is_platform_owner");
 if (owner.error || owner.data !== true) return { ok: false as const, error: "OWNER_REQUIRED" };
 const { data, error } = await client.auth.getClaims(); const sessionId = data?.claims.session_id;
 if (error || !isSyntheticUuid(sessionId) || !isSyntheticUuid(gate.context.userId)) return { ok: false as const, error: "SESSION_UNAVAILABLE" };
 return { ok: true as const, actorId: gate.context.userId, sessionId };
}
async function scope(gate: { actorId: string; sessionId: string }) {
 const config = readSyntheticGeminiConfig();
 if (!config || config.attestation.actorId !== gate.actorId ||
     config.attestation.sessionId !== gate.sessionId) return { ok: false as const, error: "FREE_SYNTHETIC_NEEDS_SETUP" };
 const admin = createAdminClient(); if (!admin) return { ok: false as const, error: "PERSISTENCE_UNAVAILABLE" };
 const { data: company, error } = await admin.from("companies").select("id,status").eq("id",config.attestation.companyId).maybeSingle();
 if (error || !company || company.id !== config.attestation.companyId || company.status === "suspended") return { ok: false as const, error: "COMPANY_UNAVAILABLE" };
 const rpc = admin.rpc as unknown as (name: string) => PromiseLike<{ data: unknown; error: unknown }>;
 const snapshot = await rpc.call(admin,"ai_admin_snapshot");
 if (snapshot.error || !snapshot.data || typeof snapshot.data !== "object" || Array.isArray(snapshot.data)) return { ok: false as const, error: "PERSISTENCE_UNAVAILABLE" };
 const data = snapshot.data as unknown as { budget?: { enabled?: unknown; limit_baisa?: unknown; spent_baisa?: unknown; held_baisa?: unknown }; recent?: { id?: unknown }[] };
 const budget = data.budget;
 if (!budget || budget.enabled !== true || ![budget.limit_baisa,budget.spent_baisa,budget.held_baisa].every(v => typeof v === "number" && Number.isFinite(v) && v>=0) ||
     Number(budget.limit_baisa)-Number(budget.spent_baisa)-Number(budget.held_baisa)<1) return { ok: false as const, error: "BUDGET_UNAVAILABLE" };
 if (!Array.isArray(data.recent)) return { ok: false as const, error: "PERSISTENCE_UNAVAILABLE" };
 if (data.recent.some(row => row.id === config.attestation.executionId)) return { ok: false as const, error: "EXECUTION_ALREADY_RECORDED" };
 return { ok: true as const, config };
}
export async function readSyntheticGeminiFreeState() {
 try {
  const gate = await ownerGate(); if (!gate.ok) return gate;
  const selected = await scope(gate);
  const data: SyntheticGeminiFreeState = selected.ok ? { ready:true,code:"READY",projectRef:selected.config.attestation.projectRef,
   modelId:selected.config.model,expiresAt:selected.config.expiresAt } : { ready:false,code:selected.error };
  return { ok:true as const,data };
 } catch { return { ok:false as const,error:"SYNTHETIC_TEST_UNAVAILABLE" }; }
}
/** Only explicit confirmation is accepted. All execution identities remain server-derived. */
export async function runSyntheticGeminiFreeTest(input: { executeConfirmed: boolean }) {
 try {
  const gate = await ownerGate(); if (!gate.ok) return gate;
  if (!input || typeof input !== "object" || Array.isArray(input) || input.executeConfirmed !== true ||
      Object.keys(input).some(k => k !== "executeConfirmed")) return { ok:false as const,error:"SYNTHETIC_INPUT_REQUIRED" };
  const selected = await scope(gate); if (!selected.ok) return selected;
  const a = selected.config.attestation;
  const result = await executeSyntheticGemini({ actorId:gate.actorId,sessionId:gate.sessionId,companyId:a.companyId,executionId:a.executionId,executeConfirmed:true });
  const again = await ownerGate();
  if (!again.ok || again.actorId !== gate.actorId || again.sessionId !== gate.sessionId) return { ok:false as const,error:"ACCESS_CHANGED_AFTER_EXECUTION" };
  return result;
 } catch { return { ok:false as const,error:"SYNTHETIC_TEST_UNAVAILABLE" }; }
}

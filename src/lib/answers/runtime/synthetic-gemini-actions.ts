"use server";
import { createClient } from "@/lib/supabase/server";
import { requireVerifiedUser } from "@/lib/tenancy/access";
import { executeSyntheticGemini } from "./synthetic-gemini";

async function ownerGate() {
  const gate = await requireVerifiedUser();
  if (!gate.ok) return { ok: false as const, error: gate.code };
  const client = await createClient();
  const owner = await client.rpc("is_platform_owner");
  if (owner.error || owner.data !== true) return { ok: false as const, error: "OWNER_REQUIRED" };
  const { data, error } = await client.auth.getClaims();
  const sessionId = data?.claims.session_id;
  if (error || typeof sessionId !== "string") return { ok: false as const, error: "SESSION_UNAVAILABLE" };
  return { ok: true as const, actorId: gate.context.userId, sessionId };
}

/** Separate owner action; accepts no customer question, knowledge, persona, model, or credentials. */
export async function runSyntheticGeminiFreeTest(input: {
  companyId: string; executionId: string; executeConfirmed: boolean;
}) {
  try {
    const gate = await ownerGate();
    if (!gate.ok) return gate;
    if (!input || Object.keys(input).some(k => !["companyId", "executionId", "executeConfirmed"].includes(k))) {
      return { ok: false as const, error: "SYNTHETIC_INPUT_REQUIRED" };
    }
    const result = await executeSyntheticGemini({ ...input, actorId: gate.actorId, sessionId: gate.sessionId });
    const again = await ownerGate();
    if (!again.ok || again.actorId !== gate.actorId || again.sessionId !== gate.sessionId) {
      return { ok: false as const, error: "ACCESS_CHANGED_AFTER_EXECUTION" };
    }
    return result;
  } catch { return { ok: false as const, error: "SYNTHETIC_TEST_UNAVAILABLE" }; }
}

"use server";

import { getAccountProfile, getWorkspaceSwitcher } from "./actions";
import { sessionHasCompanyCapability } from "@/lib/access/actions";
import { beginDiagnostic } from "@/lib/diagnostics/flow";

/** One client round trip; independent authenticated reads run on the server. */
export async function getWorkspaceView() {
  const trace = beginDiagnostic("workspace_load");
  trace.stage("workspace");
  try {
  const [switcher, identity] = await Promise.all([getWorkspaceSwitcher(), getAccountProfile()]);
  if (!switcher.ok) return { ...switcher, diagnostic: trace.finish(switcher.code) };
  if (!identity.ok) return { ...identity, diagnostic: trace.finish(identity.code) };
  const companyId = switcher.data.selectedCompanyId;
  const selected = switcher.data.choices.find(row => row.companyId === companyId);
  // Parallel reads must agree on the selected context before rendering it.
  if (identity.data.companyId !== companyId || identity.data.role !== (selected?.role ?? null)) {
    return { ok: false as const, code: "UNAVAILABLE" as const, diagnostic: trace.finish("UNAVAILABLE") };
  }
  trace.stage("permissions");
  const knowledgeAllowed = selected?.role === "owner"
    || Boolean(companyId && await sessionHasCompanyCapability(companyId, "knowledge.read") === true);
  trace.finish("OK");
  return { ok: true as const, data: { workspace: switcher.data, identity: identity.data, knowledgeAllowed } };
  } catch {
    return { ok: false as const, code: "UNAVAILABLE" as const, diagnostic: trace.finish("UNAVAILABLE") };
  }
}

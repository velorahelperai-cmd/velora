"use server";

import { getAccountProfile, getWorkspaceSwitcher } from "./actions";
import { sessionHasCompanyCapability } from "@/lib/access/actions";

/** One client round trip; independent authenticated reads run on the server. */
export async function getWorkspaceView() {
  const [switcher, identity] = await Promise.all([getWorkspaceSwitcher(), getAccountProfile()]);
  if (!switcher.ok) return switcher;
  if (!identity.ok) return identity;
  const companyId = switcher.data.selectedCompanyId;
  const selected = switcher.data.choices.find(row => row.companyId === companyId);
  // Parallel reads must agree on the selected context before rendering it.
  if (identity.data.companyId !== companyId || identity.data.role !== (selected?.role ?? null)) {
    return { ok: false as const, code: "UNAVAILABLE" as const };
  }
  const knowledgeAllowed = selected?.role === "owner"
    || Boolean(companyId && await sessionHasCompanyCapability(companyId, "knowledge.read") === true);
  return { ok: true as const, data: { workspace: switcher.data, identity: identity.data, knowledgeAllowed } };
}

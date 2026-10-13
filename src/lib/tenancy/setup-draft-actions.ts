"use server";

import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "./access";
import { setupDraftFromRow, setupDraftPayload, setupDraftScopeAllowed, type SetupDraftCode, type SetupDraftRecord, type SetupDraftResult, type SetupDraftScope } from "./setup-draft";
import type { Json } from "@/lib/database.types";

export async function readSetupDraft(scope: SetupDraftScope): Promise<SetupDraftResult<SetupDraftRecord | null>> {
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return { ok: false, code: access.code === "NO_COMPANY" ? "FORBIDDEN" : access.code };
    if (!setupDraftScopeAllowed(scope, access.context)) return { ok: false, code: "FORBIDDEN" };
    const client = await createClient();
    let query = client.from("company_setup_drafts").select("user_id,company_id,payload,revision,updated_at").eq("user_id", access.context.userId);
    query = scope.expectedCompanyId ? query.eq("company_id", scope.expectedCompanyId) : query.is("company_id", null);
    const { data, error } = await query.maybeSingle();
    if (error) return { ok: false, code: "UNAVAILABLE" };
    const draft = data ? setupDraftFromRow(data, scope) : null;
    return data && !draft ? { ok: false, code: "UNAVAILABLE" } : { ok: true, data: draft };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}

export async function saveSetupDraft(input: SetupDraftScope & { draft: unknown; expectedRevision: number }): Promise<SetupDraftResult<SetupDraftRecord>> {
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return { ok: false, code: access.code === "NO_COMPANY" ? "FORBIDDEN" : access.code };
    if (!setupDraftScopeAllowed(input, access.context)) return { ok: false, code: "FORBIDDEN" };
    const payload = setupDraftPayload(input.draft);
    const draft = input.draft as { userId?: unknown; companyId?: unknown } | null;
    if (!payload || draft?.userId !== input.expectedUserId || draft?.companyId !== input.expectedCompanyId
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) return { ok: false, code: "INVALID_INPUT" };
    const client = await createClient();
    const { data, error } = await client.rpc("save_company_setup_draft", {
      p_expected_user_id: input.expectedUserId, p_company_id: input.expectedCompanyId,
      p_expected_revision: input.expectedRevision, p_payload: payload as unknown as Json,
    });
    if (error) return { ok: false, code: "UNAVAILABLE" };
    const receipt = data as { ok?: boolean; code?: string; data?: unknown } | null;
    if (!receipt?.ok) return { ok: false, code: receipt?.code && ["FORBIDDEN", "CONFLICT", "INVALID_INPUT", "UNVERIFIED", "UNAUTHENTICATED"].includes(receipt.code) ? receipt.code as SetupDraftCode : "UNAVAILABLE" };
    const record = setupDraftFromRow(receipt.data, input);
    return record ? { ok: true, data: record } : { ok: false, code: "UNAVAILABLE" };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}

"use server";
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';

import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "./access";
import { setupDraftFromRow, setupDraftLifecycleFromRow, setupDraftPayload, setupDraftScopeAllowed, type SetupDraftCode, type SetupDraftRecord, type SetupDraftResult, type SetupDraftScope, type SetupDraftLifecycleRecord, type SetupDraftCancellationPreview } from "./setup-draft";
import type { Json } from "@/lib/database.types";

import {logEvent,withLogContext} from '@/lib/logging/logger.mjs';
const codes: SetupDraftCode[] = ["UNAUTHENTICATED", "UNVERIFIED", "FORBIDDEN", "UNAVAILABLE", "UNCONFIGURED", "INVALID_INPUT", "CONFLICT", "ACTIVE_DRAFT_EXISTS", "LEGACY_DRAFT_CONFLICT", "DRAFT_CLOSED", "DRAFT_EXPIRED", "DRAFT_BINDING_REQUIRED", "CONFIRMATION_REQUIRED", "COMPANY_REQUIRED"];
function failure(code: unknown): { ok: false; code: SetupDraftCode } { return { ok: false, code: codes.includes(code as SetupDraftCode) ? code as SetupDraftCode : "UNAVAILABLE" }; }
type DraftRpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

export async function readSetupDraft(scope: SetupDraftScope): Promise<SetupDraftResult<SetupDraftRecord | null>> {
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return { ok: false, code: access.code === "NO_COMPANY" ? "FORBIDDEN" : access.code };
    if (!setupDraftScopeAllowed(scope, access.context)) return { ok: false, code: "FORBIDDEN" };
    const client = await createClient();
    let query = client.from("company_setup_drafts").select(masterJourneyEnabled()?"user_id,company_id,payload,revision,updated_at,draft_id,state,generation,expires_at,paid_protected_at,cleanup_policy":"user_id,company_id,payload,revision,updated_at").eq("user_id", access.context.userId);
    if(masterJourneyEnabled())query=query.eq('state','active');
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
    if ((input.expectedDraftId === undefined) !== (input.expectedGeneration === undefined)
      || (input.expectedGeneration !== undefined && (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1))) return { ok: false, code: "INVALID_INPUT" };
    const { data, error } = await (client as unknown as DraftRpcClient).rpc(input.expectedDraftId ? "master_save_company_setup_draft" : "save_company_setup_draft", {
      p_expected_user_id: input.expectedUserId, p_company_id: input.expectedCompanyId,
      p_expected_revision: input.expectedRevision, p_payload: payload as unknown as Json,
      ...(input.expectedDraftId ? { p_draft_id: input.expectedDraftId, p_expected_generation: input.expectedGeneration } : {}),
    });
    if (error) return { ok: false, code: "UNAVAILABLE" };
    const receipt = data as { ok?: boolean; code?: string; data?: unknown } | null;
    if (!receipt?.ok) return failure(receipt?.code);
    const record = setupDraftFromRow(receipt.data, input);
    return record ? { ok: true, data: record } : { ok: false, code: "UNAVAILABLE" };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}

export async function readActiveSetupDraft(expectedUserId: string): Promise<SetupDraftResult<SetupDraftRecord | null>> {
  if(!masterJourneyEnabled())return failure('UNCONFIGURED');
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return failure(access.code === "NO_COMPANY" ? "FORBIDDEN" : access.code);
    if (access.context.userId !== expectedUserId) return failure("FORBIDDEN");
    const client = await createClient();
    const { data, error } = await (client as unknown as DraftRpcClient).rpc("read_active_company_setup_draft", { p_expected_user_id: expectedUserId });
    if (error) return failure("UNAVAILABLE");
    const receipt = data as { ok?: boolean; code?: unknown; data?: { company_id?: unknown } | null } | null;
    if (!receipt?.ok) return failure(receipt?.code);
    if (receipt.data === null) return { ok: true, data: null };
    if (!receipt.data || !(receipt.data.company_id === null || typeof receipt.data.company_id === "string")) return failure("UNAVAILABLE");
    const parsed = setupDraftFromRow(receipt.data, { expectedUserId, expectedCompanyId: receipt.data.company_id });
    return parsed ? { ok: true, data: parsed } : failure("UNAVAILABLE");
  } catch { return failure("UNAVAILABLE"); }
}

export async function beginSetupDraft(input: SetupDraftScope & { attemptId: string; draft: unknown }): Promise<SetupDraftResult<SetupDraftRecord>> {
  if(!masterJourneyEnabled())return failure('UNCONFIGURED');
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return failure(access.code === "NO_COMPANY" ? "FORBIDDEN" : access.code);
    if (!setupDraftScopeAllowed(input, access.context)) return failure("FORBIDDEN");
    const payload = setupDraftPayload(input.draft);
    const draft = input.draft as { userId?: unknown; companyId?: unknown } | null;
    if (!payload || draft?.userId !== input.expectedUserId || draft?.companyId !== input.expectedCompanyId || !/^[a-f0-9-]{36}$/i.test(input.attemptId)) return failure("INVALID_INPUT");
    const client = await createClient();
    const { data, error } = await (client as unknown as DraftRpcClient).rpc("begin_company_setup_draft", { p_expected_user_id: input.expectedUserId, p_company_id: input.expectedCompanyId, p_attempt_id: input.attemptId, p_payload: payload });
    if (error) return failure("UNAVAILABLE");
    const receipt = data as { ok?: boolean; code?: unknown; data?: unknown } | null;
    if (!receipt?.ok) return failure(receipt?.code);
    const parsed = setupDraftFromRow(receipt.data, { ...input, expectedDraftId: input.attemptId });
    return parsed ? { ok: true, data: parsed } : failure("UNAVAILABLE");
  } catch { return failure("UNAVAILABLE"); }
}

export async function setupDraftLifecycleAction(input: SetupDraftScope & { draftId: string; expectedRevision: number; generation: number; action: "keep" | "complete" | "preview_cancel" | "confirm_cancel"; confirmationToken?: string }): Promise<SetupDraftResult<SetupDraftLifecycleRecord | SetupDraftCancellationPreview>> {
  if(!masterJourneyEnabled())return failure('UNCONFIGURED');
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return failure(access.code === "NO_COMPANY" ? "FORBIDDEN" : access.code);
    if (!setupDraftScopeAllowed(input, access.context)) return failure("FORBIDDEN");
    if (!input.draftId || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Number.isSafeInteger(input.generation) || input.generation < 1) return failure("INVALID_INPUT");
    const client = await createClient();
    const { data, error } = await (client as unknown as DraftRpcClient).rpc("master_setup_draft_action", { p_expected_user_id: input.expectedUserId, p_draft_id: input.draftId, p_expected_revision: input.expectedRevision, p_expected_generation: input.generation, p_action: input.action, p_confirmation_token: input.confirmationToken ?? null });
    if (error) return failure("UNAVAILABLE");
    const receipt = data as { ok?: boolean; code?: unknown; data?: unknown } | null;
    if (!receipt?.ok) return failure(receipt?.code);
    if (input.action === "preview_cancel") {
      const p = receipt.data as SetupDraftCancellationPreview | null;
      return p && typeof p.confirmationToken === "string" && Number.isSafeInteger(p.scopedFileCount) && p.scopedFileCount >= 0
        && p.unscopedFilesIncluded === false && p.cleanupPolicy === "UNCONFIGURED" && ["draft_payload_only", "draft_and_setup_files"].includes(p.scope) && p.companyPreserved === true ? { ok: true, data: p } : failure("UNAVAILABLE");
    }
    const parsed = setupDraftLifecycleFromRow(receipt.data, { ...input, expectedDraftId: input.draftId });
    return parsed ? { ok: true, data: parsed } : failure("UNAVAILABLE");
  } catch { return failure("UNAVAILABLE"); }
}

/** Upload lifecycle metadata only. Never read editable setup-field payloads. */
export async function readSetupFileContext(scope:SetupDraftScope):Promise<SetupDraftResult<SetupDraftRecord|null>>{
 if(!masterJourneyEnabled())return {ok:true,data:null};
 const started=Date.now();
 const recordFailure=(error:unknown)=>withLogContext({user_id:scope.expectedUserId,...(scope.expectedCompanyId?{tenant_id:scope.expectedCompanyId}:{})},()=>logEvent('error','setup.files.context_read_failed',{kind:'application',target:'company_setup_drafts',duration_ms:Date.now()-started,error:error instanceof Error?error:new Error('SETUP_FILE_CONTEXT_READ_FAILED')}));
 try{const access=await getCompanyAccess();if(!access.ok)return failure(access.code==='NO_COMPANY'?'FORBIDDEN':access.code);
  if(!setupDraftScopeAllowed(scope,access.context))return failure('FORBIDDEN');
  const client=await createClient();let query=client.from('company_setup_drafts').select('user_id,company_id,revision,updated_at,draft_id,state,generation,expires_at,paid_protected_at,cleanup_policy').eq('user_id',access.context.userId).eq('state','active');
  query=scope.expectedCompanyId?query.eq('company_id',scope.expectedCompanyId):query.is('company_id',null);
  const {data,error}=await query.maybeSingle();if(error){recordFailure(error);return failure('UNAVAILABLE');}if(!data)return {ok:true,data:null};
  const payload={business:{name:'',type:'other',replyLanguage:'ar',country:'',city:'',hours:'',contactPhone:'',contactEmail:''},setupStep:0};
  const record=setupDraftFromRow({...data,payload},scope);return record?{ok:true,data:record}:failure('UNAVAILABLE');
 }catch(error){recordFailure(error);return failure('UNAVAILABLE');}
}
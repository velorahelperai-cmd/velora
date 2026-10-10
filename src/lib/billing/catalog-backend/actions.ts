"use server";
import { catalogRpc } from "./rpc";
import { validateDraft, type CatalogAdminSnapshot, type CatalogResult } from "./contract";
export async function readCatalogAdminAction():Promise<CatalogResult<CatalogAdminSnapshot>> {
 return catalogRpc("billing_catalog_admin_read");
}
export async function saveCatalogDraftAction(input:unknown,expectedRevision:number,versionId:string|null=null):Promise<CatalogResult<{revision:number;version_id:string}>> {
 const draft=validateDraft(input);
 if(!draft||!Number.isSafeInteger(expectedRevision)||expectedRevision<1) return {ok:false,code:"invalid_input"};
 // With no id, inserts a NEW version. Published ids cannot be edited.
 return catalogRpc("billing_catalog_admin_mutate",{p_operation:"save_draft",p_expected_revision:expectedRevision,p_version_id:versionId,p_draft:draft});
}
export async function publishCatalogVersionAction(versionId:string,expectedRevision:number):Promise<CatalogResult<{revision:number;version_id:string}>> {
 if(!versionId||!Number.isSafeInteger(expectedRevision)||expectedRevision<1) return {ok:false,code:"invalid_input"};
 return catalogRpc("billing_catalog_admin_mutate",{p_operation:"publish",p_expected_revision:expectedRevision,p_version_id:versionId,p_draft:null});
}

/** Explicit owner opt-in. SQL derives the service and capability from a locked draft. */
export async function bindNouraBasicDraftAction(versionId: unknown, expectedRevision: number): Promise<CatalogResult<{ revision: number; version_id: string }>> {
 if (typeof versionId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(versionId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return { ok: false, code: "invalid_input" };
 return catalogRpc("billing_bind_noura_basic_draft", { p_plan_version_id: versionId, p_expected_revision: expectedRevision });
}

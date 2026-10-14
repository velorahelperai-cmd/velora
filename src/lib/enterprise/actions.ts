"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { siteUrl } from "@/lib/auth/site-url";
import type { EnterpriseWorkspace, EnterpriseResult } from "./contracts";
import { parseWorkspace, uuid } from "./contracts";
import { enterpriseLifecycleEnabled } from "./config";

async function gate(expectedUserId: string, companyId: string, ownerOnly=false) {
  if (!enterpriseLifecycleEnabled()) return {ok:false as const,code:"UNCONFIGURED"};
  if (!uuid(expectedUserId)||!uuid(companyId)) return {ok:false as const,code:"INVALID_INPUT"};
  const access=await getCompanyAccess();
  if (!access.ok) return {ok:false as const,code:access.code};
  if (access.context.userId!==expectedUserId) return {ok:false as const,code:"UNAUTHENTICATED"};
  if (access.context.company?.id!==companyId||!access.context.membership||(ownerOnly&&access.context.membership.role!=="owner")) return {ok:false as const,code:"FORBIDDEN"};
  return {ok:true as const};
}
async function call(name:string,args:Record<string,unknown>) {
  const client=await createClient();
  const rpc=client.rpc as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
  const result=await rpc.call(client,name,args);
  if(result.error&&typeof result.error==="object"&&(result.error as Record<string,unknown>).code==="PGRST202")return {ok:false,code:"NOT_INSTALLED"};
  if (result.error||!result.data||typeof result.data!=="object"||Array.isArray(result.data)) return null;
  return result.data as Record<string,unknown>;
}
function failure(data:Record<string,unknown>|null) {return {ok:false as const,code:typeof data?.code==="string"?data.code:"UNAVAILABLE"};}
function refresh() {try{revalidatePath("/app/organization");}catch{/* A refresh failure cannot undo a durable commit. */}}

export async function readEnterpriseWorkspace(expectedUserId:string,companyId:string):Promise<EnterpriseResult<EnterpriseWorkspace>> {
  try {
    const access=await gate(expectedUserId,companyId);if(!access.ok)return access;
    const data=await call("enterprise_workspace",{p_company_id:companyId});if(data?.ok!==true)return failure(data);
    const view=parseWorkspace(data,companyId,expectedUserId);return view?{ok:true,data:view}:failure(null);
  }catch{return failure(null);}
}
export async function createEnterpriseBranch(input:{expectedUserId:string;companyId:string;operationId:string;name:string;timezone:string}):Promise<EnterpriseResult<{branchId:string}>> {
  try{
    if(!input||!uuid(input.operationId)||typeof input.name!=="string"||typeof input.timezone!=="string"||input.name.trim().length<1||input.name.trim().length>120||input.timezone.length>100)return failure({code:"INVALID_INPUT"});
    const access=await gate(input.expectedUserId,input.companyId,true);if(!access.ok)return access;
    const result=await call("enterprise_create_branch",{p_company_id:input.companyId,p_operation_id:input.operationId,p_name:input.name.trim(),p_timezone:input.timezone});
    if(result?.ok!==true)return failure(result);if(!uuid(result.branchId))return failure(null);
    refresh();return {ok:true,data:{branchId:result.branchId}};
  }catch{return failure(null);}
}
export async function renameEnterpriseBranch(input:{expectedUserId:string;companyId:string;branchId:string;operationId:string;name:string}):Promise<EnterpriseResult<{branchId:string}>> {
  try{
    if(!input||!uuid(input.branchId)||!uuid(input.operationId)||typeof input.name!=="string"||input.name.trim().length<1||input.name.trim().length>120)return failure({code:"INVALID_INPUT"});
    const access=await gate(input.expectedUserId,input.companyId,true);if(!access.ok)return access;
    const result=await call("enterprise_rename_branch",{p_company_id:input.companyId,p_branch_id:input.branchId,p_operation_id:input.operationId,p_name:input.name.trim()});
    if(result?.ok!==true)return failure(result);if(!uuid(result.branchId))return failure(null);refresh();return {ok:true,data:{branchId:result.branchId}};
  }catch{return failure(null);}
}
export async function inviteEnterpriseMember(input:{expectedUserId:string;companyId:string;operationId:string;branchIds:string[];role:"employee"|"manager";email:string;name:string;capabilities:string[]}):Promise<EnterpriseResult<{id:string;expiresAt:string;inviteUrl:string|null;replayed:boolean}>> {
  try{
    if(!input||!uuid(input.operationId)||!Array.isArray(input.branchIds)||!input.branchIds.length||input.branchIds.length>100||!input.branchIds.every(uuid)
      ||!Array.isArray(input.capabilities)||input.capabilities.length>100||!input.capabilities.every(x=>typeof x==="string"&&x.length<100)
      ||!["employee","manager"].includes(input.role)||(input.role==="employee"&&input.branchIds.length!==1)
      ||typeof input.email!=="string"||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())||input.email.length>254
      ||typeof input.name!=="string"||input.name.trim().length<2||input.name.trim().length>120)return failure({code:"INVALID_INPUT"});
    const access=await gate(input.expectedUserId,input.companyId,true);if(!access.ok)return access;
    const token=randomBytes(32).toString("base64url");
    const result=await call("enterprise_invite",{p_company_id:input.companyId,p_operation_id:input.operationId,p_branch_ids:[...new Set(input.branchIds)],p_role:input.role,
      p_email:input.email.trim().toLowerCase(),p_name:input.name.trim(),p_capabilities:[...new Set(input.capabilities)],p_token_hash:createHash("sha256").update(token).digest("hex")});
    if(result?.ok!==true)return failure(result);
    if(!uuid(result.id)||typeof result.expiresAt!=="string"||!Number.isFinite(Date.parse(result.expiresAt))||typeof result.replayed!=="boolean"||typeof result.tokenMatched!=="boolean"
      ||(result.replayed&&result.tokenMatched))return failure(null);
    refresh();return {ok:true,data:{id:result.id,expiresAt:result.expiresAt,replayed:result.replayed,inviteUrl:result.tokenMatched?`${siteUrl()}/accept-invite?token=${encodeURIComponent(token)}`:null}};
  }catch{return failure(null);}
}
export async function setEnterpriseMemberStatus(input:{expectedUserId:string;companyId:string;userId:string;status:"active"|"suspended"|"terminated"}):Promise<EnterpriseResult<null>> {
  try{
    if(!input||!uuid(input.userId)||!["active","suspended","terminated"].includes(input.status))return failure({code:"INVALID_INPUT"});
    const access=await gate(input.expectedUserId,input.companyId,true);if(!access.ok)return access;
    const result=await call("enterprise_set_member_status",{p_company_id:input.companyId,p_user_id:input.userId,p_status:input.status});
    if(result?.ok!==true)return failure(result);refresh();return {ok:true,data:null};
  }catch{return failure(null);}
}
export async function setEnterpriseGrants(input:{expectedUserId:string;companyId:string;branchId:string;userId:string;capabilities:string[];delegable:string[]}):Promise<EnterpriseResult<null>> {
  try{
    if(!input||!uuid(input.branchId)||!uuid(input.userId)||!Array.isArray(input.capabilities)||!Array.isArray(input.delegable)
      ||input.capabilities.length>100||input.delegable.length>100||![...input.capabilities,...input.delegable].every(x=>typeof x==="string"&&x.length<100))return failure({code:"INVALID_INPUT"});
    const access=await gate(input.expectedUserId,input.companyId);if(!access.ok)return access;
    const result=await call("enterprise_set_grants",{p_company_id:input.companyId,p_branch_id:input.branchId,p_user_id:input.userId,p_capabilities:input.capabilities,p_delegable:input.delegable});
    if(result?.ok!==true)return failure(result);refresh();return {ok:true,data:null};
  }catch{return failure(null);}
}
export async function heartbeatEnterprisePresence(expectedUserId:string,companyId:string):Promise<EnterpriseResult<{inShift:boolean}>> {
  try{
    const access=await gate(expectedUserId,companyId);if(!access.ok)return access;
    const result=await call("enterprise_presence_heartbeat",{p_company_id:companyId});
    if(result?.ok!==true)return failure(result);if(typeof result.inShift!=="boolean")return failure(null);
    return {ok:true,data:{inShift:result.inShift}};
  }catch{return failure(null);}
}

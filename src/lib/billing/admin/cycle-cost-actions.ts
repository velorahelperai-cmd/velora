"use server";
import {createClient} from "@/lib/supabase/server";
import {checkAppSession} from "@/lib/auth/session-guard";
import {masterJourneyEnabled} from "@/lib/master-journey/rollout";
import {billingUuid} from "../wiring/public-offer-policy";
import {parseAdminCycleCosts,parseCostCompanyPage,parseCostCyclePage,type AdminCycleCosts,type CostCompanyPage,type CostCycleCursor,type CostCyclePage,type CostReadResult} from "./cycle-costs";
async function read<T>(name:string,args:Record<string,unknown>,expectedUserId:string|undefined,parse:(v:unknown,uid:string)=>T|null):Promise<CostReadResult<T>>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
 try{
  const client=await createClient(),who=await client.auth.getUser();const uid=who.data.user?.id;
  if(who.error||!billingUuid(uid)||expectedUserId!==undefined&&uid!==expectedUserId)return {ok:false,code:"UNAUTHENTICATED"};
  if(!(await checkAppSession(client)).ok)return {ok:false,code:"UNAUTHENTICATED"};
  const rpc=client.rpc as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>;
  const result=await rpc.call(client,name,args);if(result.error)return {ok:false,code:result.error.code==="42501"?"FORBIDDEN":"UNAVAILABLE"};
  if(!result.data||typeof result.data!=="object"||Array.isArray(result.data))return {ok:false,code:"UNAVAILABLE"};
  const value=result.data as {ok?:unknown;data?:unknown;code?:unknown};
  if(value.ok!==true)return {ok:false,code:value.code==="FORBIDDEN"||value.code==="CYCLE_UNAVAILABLE"?value.code:"UNAVAILABLE"};
  const data=parse(value.data,uid);return data?{ok:true,data}:{ok:false,code:"UNAVAILABLE"};
 }catch{return {ok:false,code:"UNAVAILABLE"};}
}
export async function readAdminCostCompaniesAction(input?:{expectedUserId?:string;afterCompanyId?:string}):Promise<CostReadResult<CostCompanyPage>>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
 if(input?.expectedUserId!==undefined&&!billingUuid(input.expectedUserId)||input?.afterCompanyId!==undefined&&!billingUuid(input.afterCompanyId))return {ok:false,code:"INVALID_INPUT"};
 return read("master_admin_ai_cost_companies",{p_after_company_id:input?.afterCompanyId??null},input?.expectedUserId,parseCostCompanyPage);
}
export async function readAdminCostCyclesAction(input:{companyId:string;expectedUserId:string;before?:CostCycleCursor}):Promise<CostReadResult<CostCyclePage>>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
 if(!billingUuid(input?.companyId)||!billingUuid(input?.expectedUserId)||input.before!==undefined&&(!billingUuid(input.before.id)||typeof input.before.startsAt!=="string"||!/^\d{4}-\d{2}-\d{2}T/.test(input.before.startsAt)||!Number.isFinite(Date.parse(input.before.startsAt))))return {ok:false,code:"INVALID_INPUT"};
 return read("master_admin_ai_cost_cycles",{p_company_id:input.companyId,p_before_start:input.before?.startsAt??null,p_before_cycle_id:input.before?.id??null},input.expectedUserId,v=>parseCostCyclePage(v,input.companyId));
}
export async function readAdminCycleCostsAction(input:{companyId:string;cycleId:string;expectedUserId:string}):Promise<CostReadResult<AdminCycleCosts>>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
 if(!billingUuid(input?.companyId)||!billingUuid(input?.cycleId)||!billingUuid(input?.expectedUserId))return {ok:false,code:"INVALID_INPUT"};
 return read("master_admin_read_ai_cycle_costs",{p_company_id:input.companyId,p_cycle_id:input.cycleId},input.expectedUserId,v=>parseAdminCycleCosts(v,input.companyId,input.cycleId));
}

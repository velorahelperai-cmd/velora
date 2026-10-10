import "server-only";
import {createClient} from "@/lib/supabase/server";
export type CompanyBillingDisplay = {company_id:string;environment:"live";journey:Record<string,unknown>;usage:unknown;billing_paid:unknown;operational_eligible:unknown;qualified_paid_through:unknown};
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** SQL independently authorizes the session actor; callers pass their selected company. */
export async function readCompanyBillingDisplay(companyId:string):Promise<{ok:true;data:CompanyBillingDisplay}|{ok:false;code:"forbidden"|"unavailable"}> {
 try{
  const client=await createClient();
  const rpc=client as unknown as {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string}|null}>};
  const {data,error}=await rpc.rpc("billing_read_company_display_evidence",{p_company_id:companyId});
  if(error)return {ok:false,code:error.code==="42501"?"forbidden":"unavailable"};
  const result=record(data),d=record(result?.data),j=record(d?.journey);
  if(result?.ok!==true)return {ok:false,code:result?.code==="forbidden"?"forbidden":"unavailable"};
  if(!d||d.company_id!==companyId||d.environment!=="live"||!j||!("subscription" in j))return {ok:false,code:"unavailable"};
  const s=record(j.subscription);
  if(j.subscription!==null&&(!s||s.company_id!==companyId))return {ok:false,code:"unavailable"};
  return {ok:true,data:d as CompanyBillingDisplay};
 }catch{return {ok:false,code:"unavailable"};}
}

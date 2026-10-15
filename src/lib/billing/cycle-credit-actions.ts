"use server";
import {masterJourneyEnabled} from "@/lib/master-journey/rollout";
import {getCompanyAccess} from "@/lib/tenancy/access";
import {operationRpc} from "./operations/db";
import {cycleCreditSnapshot,type CycleCreditSnapshot} from "./cycle-credits";
export async function readCycleCreditsAction(expectedCompanyId:string):Promise<{ok:true;data:CycleCreditSnapshot}|{ok:false;code:string}>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
 try{
  const access=await getCompanyAccess("owner");
  if(!access.ok||access.context.company?.id!==expectedCompanyId)return {ok:false,code:"FORBIDDEN"};
  const result=await operationRpc<unknown>("master_read_ai_cycle",{p_company_id:expectedCompanyId});if(!result.ok)return result;
  const data=cycleCreditSnapshot(result.data,expectedCompanyId);return data?{ok:true,data}:{ok:false,code:"UNAVAILABLE"};
 }catch{return {ok:false,code:"UNAVAILABLE"};}
}

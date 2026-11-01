"use server";
import {getCompanyAccess} from "@/lib/tenancy/access";
import {getCustomerReadiness} from "@/lib/tenancy/actions";

export async function readDashboardReadiness(input: {actorId:string;companyId:string|null}): Promise<Awaited<ReturnType<typeof getCustomerReadiness>>> {
  try {
    const access=await getCompanyAccess();
    if(!access.ok)return {ok:false,code:access.code};
    if(access.context.userId!==input?.actorId || (access.context.company?.id??null)!==input.companyId)return {ok:false,code:"FORBIDDEN"};
    const result=await getCustomerReadiness();
    if(result.ok&&result.data.companyId!==input.companyId)return {ok:false,code:"FORBIDDEN"};
    return result;
  } catch {return {ok:false,code:"UNAVAILABLE"};}
}

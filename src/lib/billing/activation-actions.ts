'use server';
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {operationRpc} from './operations/db';
import {parseActivationState,type ActivationState} from './activation';
export async function readSubscriptionActivationAction(expectedCompanyId:string):Promise<{ok:true;data:ActivationState}|{ok:false;code:string}>{
 if(!masterJourneyEnabled())return {ok:false,code:'UNCONFIGURED'};
 const access=await getCompanyAccess('owner');
 if(!access.ok||!access.context.company||access.context.company.id!==expectedCompanyId)return {ok:false,code:'forbidden'};
 const result=await operationRpc<unknown>('master_read_subscription_activation',{p_company_id:expectedCompanyId});
 if(!result.ok)return result;
 const parsed=parseActivationState(result.data,expectedCompanyId);
 return parsed?{ok:true,data:parsed}:{ok:false,code:'unavailable'};
}

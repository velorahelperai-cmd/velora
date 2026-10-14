"use server";
import {getCompanyAccess} from '@/lib/tenancy/access';
import {createAdminClient} from '@/lib/supabase/admin';
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';
import {readBillingActorSession} from './wiring/public-purchase-persist';
import {billingUuid} from './wiring/public-offer-policy';
import {readBusinessLifecycle} from '@/lib/tenancy/business-archive-actions';
type Scope={expectedCompanyId:string;expectedUserId?:string;ownerHistory?:true};
type Consent={termsVersion?:string;consentAccepted?:boolean};
type Operation=Scope&{obligationId:string;clientOpId:string};
type Result={ok:true;data?:Record<string,unknown>}|{ok:false;code:string};
type Rpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
const validInput=(input:unknown,keys:string[]):input is Record<string,unknown>=>Boolean(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>keys.includes(k)));
const operationKey=(value:unknown)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=128;
const consent=(input:Consent)=>input.consentAccepted===true&&operationKey(input.termsVersion);
async function scopedRpc(input:Scope,name:string,args:Record<string,unknown>):Promise<Result>{
 if(input.ownerHistory!==undefined&&input.ownerHistory!==true)return {ok:false,code:'INVALID_INPUT'};
 const history=input.ownerHistory===true;
 if(history&&(!billingUuid(input.expectedUserId)||!['master_read_renewal_wallet','master_request_excess_refund','master_set_auto_renew'].includes(name)||name==='master_set_auto_renew'&&args.p_enabled!==false))return {ok:false,code:'FORBIDDEN'};
 const access=await getCompanyAccess(history?undefined:'owner');
 if(!access.ok||input.expectedUserId!==undefined&&input.expectedUserId!==access.context.userId)return {ok:false,code:'FORBIDDEN'};
 if(history){
  const owned=await readBusinessLifecycle(access.context.userId);
  if(!owned.ok||!owned.data.some(b=>b.id===input.expectedCompanyId))return {ok:false,code:'FORBIDDEN'};
 }else if(access.context.company?.id!==input.expectedCompanyId||access.context.membership?.role!=='owner'||access.context.membership.status!=='active')return {ok:false,code:'FORBIDDEN'};
 const session=await readBillingActorSession(access.context.userId);if(!session)return {ok:false,code:'FORBIDDEN'};
 const admin=createAdminClient();if(!admin)return {ok:false,code:'BILLING_SCHEMA_UNAVAILABLE'};
 try{
  const {data,error}=await (admin as unknown as Rpc).rpc(name,{...args,p_company_id:input.expectedCompanyId,p_actor_id:access.context.userId,p_actor_session_id:session});
  if(error||!data||typeof data!=='object'||Array.isArray(data))return {ok:false,code:'BILLING_SCHEMA_UNAVAILABLE'};
  const result=data as Record<string,unknown>;if(result.ok!==true)return {ok:false,code:typeof result.code==='string'?result.code:'BILLING_CONTRACT_REJECTED'};
  return {ok:true,data:result};
 }catch{return {ok:false,code:'BILLING_SCHEMA_UNAVAILABLE'};}
}
export async function readRenewalWalletAction(input:Scope):Promise<Result>{
 if(!masterJourneyEnabled())return {ok:false,code:'MASTER_JOURNEY_UNCONFIGURED'};
 if(!validInput(input,['expectedCompanyId','expectedUserId','ownerHistory'])||!billingUuid(input.expectedCompanyId))return {ok:false,code:'INVALID_INPUT'};
 return scopedRpc(input,'master_read_renewal_wallet',{});
}
export async function setAutoRenewAction(input:Scope&Consent&{enabled:boolean;planVersionId?:string;amountBaisa?:number;currency?:'OMR';nextDueAt?:string}):Promise<Result>{
 if(!masterJourneyEnabled())return {ok:false,code:'MASTER_JOURNEY_UNCONFIGURED'};
 if(!validInput(input,['expectedCompanyId','expectedUserId','ownerHistory','enabled','termsVersion','consentAccepted','planVersionId','amountBaisa','currency','nextDueAt'])||!billingUuid(input.expectedCompanyId)||typeof input.enabled!=='boolean')return {ok:false,code:'INVALID_INPUT'};
 if(input.enabled&&!consent(input))return {ok:false,code:'CONSENT_REQUIRED'};
 if(input.enabled&&(!billingUuid(input.planVersionId)||!Number.isSafeInteger(input.amountBaisa)||Number(input.amountBaisa)<=0||input.currency!=='OMR'||typeof input.nextDueAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(input.nextDueAt)||!Number.isFinite(Date.parse(input.nextDueAt))))return {ok:false,code:'AUTORENEW_CONSENT_SNAPSHOT_REQUIRED'};
 return scopedRpc(input,'master_set_auto_renew',{p_enabled:input.enabled,p_terms_version:input.termsVersion??null,p_accepted:input.consentAccepted===true,p_expected_plan_version_id:input.planVersionId??null,p_expected_amount_baisa:input.amountBaisa??null,p_expected_currency:input.currency??null,p_expected_due_at:input.nextDueAt??null});
}
export async function convertExcessCollectionAction(input:Operation&Consent):Promise<Result>{
 if(!masterJourneyEnabled())return {ok:false,code:'MASTER_JOURNEY_UNCONFIGURED'};
 if(!validInput(input,['expectedCompanyId','obligationId','clientOpId','termsVersion','consentAccepted'])||!billingUuid(input.expectedCompanyId)||!billingUuid(input.obligationId)||!operationKey(input.clientOpId))return {ok:false,code:'INVALID_INPUT'};
 if(!consent(input))return {ok:false,code:'CONSENT_REQUIRED'};
 return scopedRpc(input,'master_convert_excess_to_wallet',{p_obligation_id:input.obligationId,p_client_op_id:input.clientOpId.trim(),p_terms_version:input.termsVersion,p_accepted:true});
}
export async function requestExcessRefundAction(input:Operation):Promise<Result>{
 if(!masterJourneyEnabled())return {ok:false,code:'MASTER_JOURNEY_UNCONFIGURED'};
 if(!validInput(input,['expectedCompanyId','expectedUserId','ownerHistory','obligationId','clientOpId'])||!billingUuid(input.expectedCompanyId)||!billingUuid(input.obligationId)||!operationKey(input.clientOpId))return {ok:false,code:'INVALID_INPUT'};
 return scopedRpc(input,'master_request_excess_refund',{p_obligation_id:input.obligationId,p_client_op_id:input.clientOpId.trim()});
}
export async function payRenewalFromWalletAction(input:Scope&Consent&{planVersionId:string;expectedCatalogRevision:number;clientOpId:string}):Promise<Result>{
 if(!masterJourneyEnabled())return {ok:false,code:'MASTER_JOURNEY_UNCONFIGURED'};
 if(!validInput(input,['expectedCompanyId','planVersionId','expectedCatalogRevision','clientOpId','termsVersion','consentAccepted'])||!billingUuid(input.expectedCompanyId)||!billingUuid(input.planVersionId)||!operationKey(input.clientOpId)||!Number.isSafeInteger(input.expectedCatalogRevision)||input.expectedCatalogRevision<1)return {ok:false,code:'INVALID_INPUT'};
 if(!consent(input))return {ok:false,code:'CONSENT_REQUIRED'};
 return scopedRpc(input,'master_wallet_pay_renewal',{p_plan_version_id:input.planVersionId,p_expected_revision:input.expectedCatalogRevision,p_client_op_id:input.clientOpId.trim(),p_terms_version:input.termsVersion,p_accepted:true});
}

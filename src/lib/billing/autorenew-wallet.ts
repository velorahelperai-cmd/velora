import 'server-only';
import {billingUuid} from './wiring/public-offer-policy';
export type RenewalLease={id:string;leaseToken:string};
export type CommittedRenewal=RenewalLease&{companyId:string;orderId:string;paymentAttemptId:string;billingCycleId:string;provider:'paymob';environment:'live';accountRef:string;mandateRef:string;amountBaisa:number;currency:'OMR';idempotencyKey:string};
type Submission={kind:'submitted';providerOrderId:string;providerIntentionId:string|null}|{kind:'unknown'};
export type RecurringProvider={provider:'paymob';environment:'live';accountRef:string;submit(input:CommittedRenewal):Promise<Submission>}|{configuration:'UNCONFIGURED'};
// Paymob recurring capabilities, signed mandate attestation and merchant approval
// are not configured. This adapter never invokes a provider or guesses a method.
export const unconfiguredRecurringProvider:RecurringProvider={configuration:'UNCONFIGURED'};
export type RecurringPorts={claim():Promise<RenewalLease|null>;authorize(lease:RenewalLease):Promise<{ok:true;data:CommittedRenewal}|{ok:false;code:string}>;recordUnknown(id:string,leaseToken:string):Promise<boolean>;recordSubmitted(claim:CommittedRenewal,provider:{providerOrderId:string;providerIntentionId:string|null}):Promise<boolean>};
type NativeRpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
// This port consumes only the native company/lease/cycle/consent proof RPCs.
// A configured provider is still a separate externally approved capability.
export function createRecurringBillingPorts(admin:NativeRpc):RecurringPorts{
 const call=async(name:string,args:Record<string,unknown>)=>{const r=await admin.rpc(name,args);if(r.error)throw Error('NATIVE_RENEWAL_PROOF_UNAVAILABLE');return r.data;};
 return {
  claim:async()=>{const data=await call('master_claim_renewal_candidate',{});if(data===null)return null;if(!data||typeof data!=='object'||!billingUuid((data as RenewalLease).id)||!billingUuid((data as RenewalLease).leaseToken))throw Error('NATIVE_RENEWAL_LEASE_INVALID');return data as RenewalLease;},
  authorize:async lease=>{const result=await call('master_authorize_renewal_attempt',{p_attempt_id:lease.id,p_lease_token:lease.leaseToken});if(!result||typeof result!=='object')throw Error('NATIVE_RENEWAL_PROOF_INVALID');const r=result as {ok?:boolean;data?:CommittedRenewal;code?:string};return r.ok===true&&r.data?{ok:true,data:r.data}:{ok:false,code:r.code??'NATIVE_RENEWAL_PROOF_INVALID'};},
  recordUnknown:async(id,leaseToken)=>(await call('master_record_recurring_unknown',{p_attempt_id:id,p_lease_token:leaseToken}))===true,
  recordSubmitted:async(c,p)=>(await call('master_record_recurring_submission',{p_attempt_id:c.id,p_lease_token:c.leaseToken,p_provider_order_id:p.providerOrderId,p_provider_intention_id:p.providerIntentionId}))===true,
 };
}
export async function runRecurringCollection(enabled:boolean,provider:RecurringProvider,ports:RecurringPorts):Promise<{ok:boolean;submitted?:number;code?:string}>{
 if(!enabled)return {ok:false,code:'MASTER_JOURNEY_DISABLED'};
 if('configuration' in provider)return {ok:false,code:'RECURRING_PROVIDER_UNCONFIGURED'};
 let committed:CommittedRenewal|null=null;
 try{
  const lease=await ports.claim();if(!lease)return {ok:true,submitted:0};
  const authorized=await ports.authorize(lease);if(!authorized.ok)return {ok:true,submitted:0};
  const c=authorized.data;committed=c;
  if(![c.id,c.leaseToken,c.companyId,c.orderId,c.paymentAttemptId,c.billingCycleId].every(billingUuid)
   ||c.id!==lease.id||c.leaseToken!==lease.leaseToken||c.provider!==provider.provider||c.environment!==provider.environment||c.accountRef!==provider.accountRef
   ||c.currency!=='OMR'||!Number.isSafeInteger(c.amountBaisa)||c.amountBaisa<=0||!c.mandateRef?.trim()||!c.idempotencyKey?.trim()){
   await ports.recordUnknown(c.id,c.leaseToken);return {ok:false,code:'RECURRING_BINDING_INVALID'};
  }
  const result=await provider.submit(c);
  if(result.kind!=='submitted'||!/^[1-9][0-9]{0,15}$/.test(result.providerOrderId)||!Number.isSafeInteger(Number(result.providerOrderId))){await ports.recordUnknown(c.id,c.leaseToken);return {ok:false,code:'PAYMENT_RECONCILIATION_REQUIRED'};}
  if(!await ports.recordSubmitted(c,{providerOrderId:result.providerOrderId,providerIntentionId:result.providerIntentionId})){await ports.recordUnknown(c.id,c.leaseToken);return {ok:false,code:'PAYMENT_RECONCILIATION_REQUIRED'};}
  // Provider initiation is not proof of payment or entitlement. Only the native
  // HMAC receiver/settlement and independently bound evidence can finalize it.
  return {ok:true,submitted:1};
 }catch{
  if(committed)await ports.recordUnknown(committed.id,committed.leaseToken).catch(()=>false);
  return {ok:false,code:'PAYMENT_RECONCILIATION_REQUIRED'};
 }
}

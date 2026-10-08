import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createAdminClient} from "@/lib/supabase/admin";
import {getPaymobOmrConversionState} from "@/lib/billing/paymob/config";
import {processStoredPaymobEvent,type StoredProviderEvent} from "@/lib/billing/wiring/event-process";
import {settleHmacVerifiedViaRpc} from "@/lib/billing/wiring/store";
import {processDurableBillingJobs,type ProcessingOutcome} from "./processing";
import {isRecoverableStoredPaymobEvent} from "@/lib/billing/wiring/order-event-processing";
import {blocksSettlement,readBillingPaymobWiringFlags} from "@/lib/billing/wiring/flags";
export async function reconcileStoredBillingEvent(eventId:string):Promise<ProcessingOutcome>{
 const flags=readBillingPaymobWiringFlags();const disabled=blocksSettlement(flags);
 if(disabled)return {kind:"blocked",code:disabled};
 if(getPaymobOmrConversionState().status==="NOT_CONFIGURED")return {kind:"blocked",code:"omr_conversion_not_configured"};
 const admin=createAdminClient() as unknown as SupabaseClient|null;if(!admin)return {kind:"blocked",code:"server_reader_unavailable"};
 const {data:event,error}=await admin.from("billing_provider_events").select("id,company_id,payment_attempt_id,provider_transaction_id,event_status,provider_account_ref,amount_baisa_expected,observation_key,provider_environment,raw_summary").eq("id",eventId).maybeSingle();
 if(error)return {kind:"retry",code:"event_read_failed"};
 if(!event||!["success","refunded","voided"].includes(event.event_status)||!["test","live"].includes(event.provider_environment))return {kind:"review",code:"event_ineligible"};
 if(event.provider_environment==="live"&&!flags.liveEnabled)return {kind:"blocked",code:"live_disabled"};
 if(!isRecoverableStoredPaymobEvent(event.event_status,event.raw_summary))return {kind:"review",code:"stored_evidence_requires_reconciliation"};
 const {data:attempt,error:attemptError}=await admin.from("billing_payment_attempts").select("order_id").eq("id",event.payment_attempt_id).eq("company_id",event.company_id).maybeSingle();
 if(attemptError)return {kind:"retry",code:"attempt_read_failed"};if(!attempt)return {kind:"review",code:"attempt_missing"};
 const {data:order,error:orderError}=await admin.from("billing_orders").select("id,special_reference,amount_baisa,provider_environment,provider_account_ref,currency").eq("id",attempt.order_id).eq("company_id",event.company_id).maybeSingle();
 if(orderError)return {kind:"retry",code:"order_read_failed"};if(!order||!Number.isSafeInteger(Number(order.amount_baisa))||Number(order.amount_baisa)<=0||Number(order.amount_baisa)!==Number(event.amount_baisa_expected))return {kind:"review",code:"amount_binding_mismatch"};
 if(order.provider_environment!==event.provider_environment||order.provider_account_ref!==event.provider_account_ref||order.currency!=="OMR")return {kind:"review",code:"provider_scope_binding_mismatch"};
 const stored:StoredProviderEvent={id:String(event.id),companyId:String(event.company_id),orderId:String(order.id),paymentAttemptId:String(event.payment_attempt_id),providerTransactionId:String(event.provider_transaction_id),eventStatus:event.event_status,providerEnvironment:event.provider_environment,providerAccountRef:String(event.provider_account_ref),specialReference:String(order.special_reference),amountBaisa:Number(order.amount_baisa),observationKey:String(event.observation_key)};
 const result=await processStoredPaymobEvent({event:stored,deps:{settleEnabled:true,settleHmacVerified:settleHmacVerifiedViaRpc}});
 if(!result.ok){
  const blocked=["provider_verification_not_implemented","settle_disabled","PGRST202","42P01"].includes(result.code);
  const permanent=["P0001","settle_result_invalid","INVALID_STORED_EVIDENCE","INVALID_REVERSAL_EVIDENCE"].includes(result.code)||result.code.startsWith("22")||result.code.startsWith("23");
  return {kind:blocked?"blocked":permanent?"review":"retry",code:result.code};
 }
 return {kind:["duplicate_collection_review","lifecycle_review","late_payment_review","deadline_policy_review"].includes(result.outcome)?"review":result.outcome==="granted"||result.outcome==="idempotent_replay"?"done":"blocked",code:result.outcome};
}
export async function runStoredBillingReconciliation(limit=20){return processDurableBillingJobs(reconcileStoredBillingEvent,limit);}

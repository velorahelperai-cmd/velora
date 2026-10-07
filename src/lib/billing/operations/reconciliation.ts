import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createAdminClient} from "@/lib/supabase/admin";
import {getPaymobOmrConversionState} from "@/lib/billing/paymob/config";
import {processStoredPaymobEvent,type StoredProviderEvent} from "@/lib/billing/wiring/event-process";
import {settleHmacVerifiedViaRpc} from "@/lib/billing/wiring/store";
import {processDurableBillingJobs,type ProcessingOutcome} from "./processing";
export async function reconcileStoredBillingEvent(eventId:string):Promise<ProcessingOutcome>{
 if(getPaymobOmrConversionState().status==="NOT_CONFIGURED")return {kind:"blocked",code:"omr_conversion_not_configured"};
 const admin=createAdminClient() as unknown as SupabaseClient|null;if(!admin)return {kind:"blocked",code:"server_reader_unavailable"};
 const {data:event,error}=await admin.from("billing_provider_events").select("id,company_id,payment_attempt_id,provider_transaction_id,event_status,provider_account_ref,amount_baisa_expected,observation_key,provider_environment").eq("id",eventId).maybeSingle();
 if(error)return {kind:"retry",code:"event_read_failed"};
 if(!event||event.event_status!=="success"||event.provider_environment!=="test")return {kind:"review",code:"event_ineligible"};
 const {data:attempt,error:attemptError}=await admin.from("billing_payment_attempts").select("order_id").eq("id",event.payment_attempt_id).eq("company_id",event.company_id).maybeSingle();
 if(attemptError)return {kind:"retry",code:"attempt_read_failed"};if(!attempt)return {kind:"review",code:"attempt_missing"};
 const {data:order,error:orderError}=await admin.from("billing_orders").select("id,special_reference,amount_baisa").eq("id",attempt.order_id).eq("company_id",event.company_id).maybeSingle();
 if(orderError)return {kind:"retry",code:"order_read_failed"};if(!order||!Number.isSafeInteger(Number(order.amount_baisa))||Number(order.amount_baisa)!==Number(event.amount_baisa_expected))return {kind:"review",code:"amount_binding_mismatch"};
 const stored:StoredProviderEvent={id:String(event.id),companyId:String(event.company_id),orderId:String(order.id),paymentAttemptId:String(event.payment_attempt_id),providerTransactionId:String(event.provider_transaction_id),eventStatus:"success",providerAccountRef:String(event.provider_account_ref),specialReference:String(order.special_reference),amountBaisa:Number(order.amount_baisa),observationKey:String(event.observation_key)};
 const result=await processStoredPaymobEvent({event:stored,deps:{settleEnabled:true,settleHmacVerified:settleHmacVerifiedViaRpc}});
 if(!result.ok)return {kind:["provider_verification_not_implemented","settle_disabled"].includes(result.code)?"blocked":"review",code:result.code};
 return {kind:result.outcome==="duplicate_collection_review"?"review":result.outcome==="granted"||result.outcome==="idempotent_replay"?"done":"blocked",code:result.outcome};
}
export async function runStoredBillingReconciliation(limit=20){return processDurableBillingJobs(reconcileStoredBillingEvent,limit);}

import "server-only";
import {readBillingPaymobWiringFlags} from "@/lib/billing/wiring/flags";
import {operationRpc} from "./db";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createAdminClient} from "@/lib/supabase/admin";
import {readPaymobServerConfig} from "../paymob/server-config";
import type {PaymobAdapterConfig} from "../paymob/config";
import {commercialBaisaToVerifiedPaymobAmount} from "../money";
import {isRecoverableStoredPaymobEvent} from "../wiring/order-event-processing";
import {billingUuid} from "../wiring/public-offer-policy";
export type ClaimedProcessingJob={event_id:string;lease_token:string;attempts:number};
export async function enqueueStoredBillingEvent(eventId:string){return operationRpc<{event_id:string}>("billing_enqueue_processing",{p_event_id:eventId},true);}
export type ProcessingOutcome={kind:"done"|"review"|"blocked"|"retry";code:string};
/** Stored signed evidence, not browser fields or a new provider inquiry. */
async function qualifyLiveProcessingEvent(eventId:string,config:PaymobAdapterConfig):Promise<ProcessingOutcome|null>{
 const admin=createAdminClient() as unknown as SupabaseClient|null;
 if(!admin)return {kind:"blocked",code:"server_reader_unavailable"};
 try{
  const {data:event,error}=await admin.from("billing_provider_events")
   .select("provider_environment,provider_account_ref,amount_baisa_expected,currency_expected,event_status,raw_summary").eq("id",eventId).maybeSingle();
  if(error)return {kind:"retry",code:"event_read_failed"};
  if(!event)return {kind:"review",code:"event_missing"};
  const summary=event.raw_summary&&typeof event.raw_summary==="object"&&!Array.isArray(event.raw_summary)?event.raw_summary as Record<string,unknown>:null;
  if(event.provider_environment!=="live"||event.provider_account_ref!==String(config.integrationId)
   ||event.currency_expected!=="OMR"||!summary||summary.hmac_verified!==true
   ||summary.signed_owner!==config.merchantOwnerId||summary.integration_id!==config.integrationId||summary.currency!=="OMR")return {kind:"review",code:"provider_scope_binding_mismatch"};
  if(!isRecoverableStoredPaymobEvent(event.event_status,summary))return {kind:"review",code:"stored_evidence_requires_reconciliation"};
  const amount=commercialBaisaToVerifiedPaymobAmount(event.amount_baisa_expected,config.verifiedOmrUnitsPerOmr??NaN);
  if(!amount.ok||amount.amount!==summary.amount_cents)return {kind:"review",code:"provider_amount_binding_mismatch"};
  return null;
 }catch{return {kind:"retry",code:"event_read_failed"};}
}
// Internal hook only; no public route/scheduler. Settlement port must reuse stored
// verified evidence + existing atomic settlement bridge, never return-query fields.
export async function processDurableBillingJobs(settleStoredEvent:(eventId:string,signal?:AbortSignal)=>Promise<ProcessingOutcome>,limit=20){
 const flags=readBillingPaymobWiringFlags();if(!flags.settleEnabled)return {ok:false as const,code:"settle_disabled"};
 if(!Number.isInteger(limit)||limit<1||limit>50)return {ok:false as const,code:"invalid_input"};
 let liveConfig:PaymobAdapterConfig|null=null;
 if(flags.liveEnabled){
  if(!flags.webhookEnabled)return {ok:false as const,code:"webhook_disabled"};
  const config=readPaymobServerConfig("live");if(!config.ok)return {ok:false as const,code:"live_not_configured"};
  const testIntegration=process.env.PAYMOB_INTEGRATION_ID_TEST?.trim()??"";
  if(!/^[1-9][0-9]*$/.test(testIntegration)||!Number.isSafeInteger(Number(testIntegration))||Number(testIntegration)===config.config.integrationId)return {ok:false as const,code:"integration_mode_isolation_required"};
  liveConfig=config.config;
 }
 const outcomes:Record<string,number>={};let processed=0;
 // Start each lease only when its work can begin; sequential batch leases expire.
 for(let index=0;index<limit;index++){
  const claimed=await operationRpc<ClaimedProcessingJob[]>("billing_claim_processing",{p_limit:1},true);if(!claimed.ok)return claimed;
  if(!Array.isArray(claimed.data)||claimed.data.length>1)return {ok:false as const,code:"processing_claim_invalid"};
  const job=claimed.data[0];if(!job)break;
  if(!billingUuid(job.event_id)||!billingUuid(job.lease_token)||!Number.isSafeInteger(job.attempts)||job.attempts<1)return {ok:false as const,code:"processing_claim_invalid"};
  let result:ProcessingOutcome;
  const controller=new AbortController();let timeout:ReturnType<typeof setTimeout>|undefined;
  try{result=await Promise.race([(async()=>{const scope=liveConfig?await qualifyLiveProcessingEvent(job.event_id,liveConfig):null;controller.signal.throwIfAborted();return scope??settleStoredEvent(job.event_id,controller.signal);})(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error("processing_timeout"));},45000);})]);}catch{result={kind:"retry",code:"processing_transient"};}finally{if(timeout!==undefined)clearTimeout(timeout);}
  const saved=await operationRpc("billing_finish_processing",{p_event_id:job.event_id,p_lease_token:job.lease_token,p_outcome:result.kind,p_code:result.code},true);
  if(!saved.ok)return saved;processed++;outcomes[result.kind]=(outcomes[result.kind]??0)+1;
 }
 return {ok:true as const,data:{processed,outcomes}};
}

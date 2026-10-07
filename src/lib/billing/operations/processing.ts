import "server-only";
import {readBillingPaymobWiringFlags} from "@/lib/billing/wiring/flags";
import {operationRpc} from "./db";
export type ClaimedProcessingJob={event_id:string;lease_token:string;attempts:number};
export async function enqueueStoredBillingEvent(eventId:string){return operationRpc<{event_id:string}>("billing_enqueue_processing",{p_event_id:eventId},true);}
export type ProcessingOutcome={kind:"done"|"review"|"blocked"|"retry";code:string};
// Internal hook only; no public route/scheduler. Settlement port must reuse stored
// verified evidence + existing atomic settlement bridge, never return-query fields.
export async function processDurableBillingJobs(settleStoredEvent:(eventId:string,signal?:AbortSignal)=>Promise<ProcessingOutcome>,limit=20){
 const flags=readBillingPaymobWiringFlags();if(!flags.settleEnabled||flags.liveEnabled)return {ok:false as const,code:flags.liveEnabled?"live_rejected":"settle_disabled"};
 if(!Number.isInteger(limit)||limit<1||limit>50)return {ok:false as const,code:"invalid_input"};
 const outcomes:Record<string,number>={};let processed=0;
 // Start each lease only when its work can begin; sequential batch leases expire.
 for(let index=0;index<limit;index++){
  const claimed=await operationRpc<ClaimedProcessingJob[]>("billing_claim_processing",{p_limit:1},true);if(!claimed.ok)return claimed;
  const job=claimed.data[0];if(!job)break;
  let result:ProcessingOutcome;
  const controller=new AbortController();let timeout:ReturnType<typeof setTimeout>|undefined;
  try{result=await Promise.race([settleStoredEvent(job.event_id,controller.signal),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error("processing_timeout"));},45000);})]);}catch{result={kind:"retry",code:"processing_transient"};}finally{if(timeout!==undefined)clearTimeout(timeout);}
  const saved=await operationRpc("billing_finish_processing",{p_event_id:job.event_id,p_lease_token:job.lease_token,p_outcome:result.kind,p_code:result.code},true);
  if(!saved.ok)return saved;processed++;outcomes[result.kind]=(outcomes[result.kind]??0)+1;
 }
 return {ok:true as const,data:{processed,outcomes}};
}

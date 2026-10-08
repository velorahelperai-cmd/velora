import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AnswerCitation } from "../types";
export type RuntimeAttemptReserveInput = {id:string;attempt:number;model:string;provider:string;reservedBaisa:number;pricingVersion:string;pricingSnapshot:unknown;sourceCitations?:AnswerCitation[]};
export type RuntimeReserveInput = RuntimeAttemptReserveInput & {executionId:string;companyId:string;actorId:string;sessionId:string;usageMode:"admin_test"|"company_live"};
export type RuntimeSettleInput = {id:string;status:string;costUsd:number|null;costBaisa:number|null;usage:unknown;requestId?:string;responseId?:string;actualModelId?:string;responseText?:string;errorCode?:string;latencyMs:number};
export interface ReservedRuntimeStore {
 reserve(input:RuntimeAttemptReserveInput):Promise<{ok:boolean;code?:string}>;
 start(id:string):Promise<boolean>;
 settle(input:RuntimeSettleInput):Promise<boolean>;
}
export interface RealRuntimeStore {
 reserve(input:RuntimeReserveInput):Promise<{ok:boolean;code?:string}>;
 start(id:string):Promise<boolean>;
 settle(input:RuntimeSettleInput):Promise<boolean>;
}
export function createRealRuntimeStore():RealRuntimeStore {
 const client=createAdminClient();if(!client)throw Error("PERSISTENCE_UNAVAILABLE");
 const rpc=client.rpc as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
 async function call(name:string,args:Record<string,unknown>){const result=await rpc.call(client,name,args);if(result.error)throw Error("LEDGER_WRITE_FAILED");return result.data;}
 return {
  async reserve(i){
   const data=await call("ai_reserve_attempt",{p_id:i.id,p_execution_id:i.executionId,p_attempt:i.attempt,p_company_id:i.companyId,p_actor_id:i.actorId,p_session_id:i.sessionId,p_model_id:i.model,p_provider:i.provider,p_reserved_baisa:i.reservedBaisa,p_pricing_version:i.pricingVersion,p_pricing_snapshot:i.pricingSnapshot,p_usage_mode:i.usageMode});
   if(!data||typeof data!=="object"||Array.isArray(data))throw Error("INVALID_RESERVATION_RESULT");
   const row=data as Record<string,unknown>;
   if(row.ok===false&&typeof row.code==="string"&&row.code.trim())return {ok:false,code:row.code};
   if(row.ok!==true||row.id!==i.id||typeof row.remaining_baisa!=="number"||!Number.isFinite(row.remaining_baisa)||row.remaining_baisa<0)throw Error("INVALID_RESERVATION_RESULT");
   return {ok:true};
  },
  async start(id){return await call("ai_start_attempt",{p_id:id})===true;},
  async settle(i){return await call("ai_settle_attempt",{p_id:i.id,p_status:i.status,p_cost_usd:i.costUsd,p_cost_baisa:i.costBaisa,p_usage:i.usage,p_request_id:i.requestId??null,p_error_code:i.errorCode??null,p_latency_ms:i.latencyMs})===true;},
 };
}

import "server-only";
import {operationRpc} from "./db";
export async function reserveAutomatedOutbound(companyId:string,intentId:string){return operationRpc<{status:string;reused:boolean;can_dispatch:boolean}>("billing_reserve_automated_outbound",{p_company_id:companyId,p_intent_id:intentId},true);}
// Count ONLY a persisted accepted assistant intent + matching outbound message;
// rejected releases reservation, unknown retains capacity, replay never double-counts.
export async function finalizeAutomatedOutboundUsage(companyId:string,intentId:string){return operationRpc<{status:string;reused?:boolean}>("billing_finalize_automated_usage",{p_company_id:companyId,p_intent_id:intentId},true);}
export async function reserveAiCost(companyId:string,operationKey:string,maxAtoms:number){
 if(!Number.isSafeInteger(maxAtoms)||maxAtoms<=0)return {ok:false as const,code:"invalid_input"};
 return operationRpc<Record<string,unknown>>("billing_reserve_ai_cost",{p_company_id:companyId,p_operation_key:operationKey,p_max_atoms:maxAtoms},true);
}
export async function recordAiCost(input:{companyId:string;operationKey:string;inputTokens:number|null;outputTokens:number|null;actualAtoms:number|null;outcome:"recorded"|"released"|"unknown"}){
 if([input.inputTokens,input.outputTokens,input.actualAtoms].some(n=>n!==null&&(!Number.isSafeInteger(n)||n<0)))return {ok:false as const,code:"invalid_input"};
 return operationRpc<Record<string,unknown>>("billing_record_ai_cost",{p_company_id:input.companyId,p_operation_key:input.operationKey,p_input_tokens:input.inputTokens,p_output_tokens:input.outputTokens,p_actual_atoms:input.actualAtoms,p_outcome:input.outcome},true);
}

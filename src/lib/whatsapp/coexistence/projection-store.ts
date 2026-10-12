import "server-only";
import type {CoexistenceIngressClient} from "./webhook-store";
export type CoexistenceOutboundProofInput={companyId:string;linkId:string;linkGeneration:number;wabaId:string;phoneNumberId:string;waMessageId:string;status:string;recipientWaId:string;occurredAt:string};
type Failure={ok:false;code:"INVALID_INPUT"|"CONNECTION_UNAVAILABLE"|"UNAVAILABLE";retry:boolean};
const object=(x:unknown):Record<string,unknown>|null=>x!==null&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:null;
const uuid=(x:unknown):x is string=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const count=(x:unknown):x is number=>typeof x==="number"&&Number.isSafeInteger(x)&&x>=0;
const fail=(code:Failure["code"]="UNAVAILABLE"):Failure=>({ok:false,code,retry:code==="UNAVAILABLE"});
function failure(row:Record<string,unknown>|null):Failure{return fail(row?.code==="INVALID_INPUT"||row?.code==="CONNECTION_UNAVAILABLE"?row.code:"UNAVAILABLE");}
/** Called after signed status persistence. The database requires an accepted staff intent. */
export async function recordCoexistenceOutboundProof(client:CoexistenceIngressClient,input:CoexistenceOutboundProofInput):Promise<{ok:true;verified:boolean}|Failure>{
 if(!["delivered","read"].includes(input?.status))return {ok:true,verified:false};
 if(!uuid(input.companyId)||!uuid(input.linkId)||!count(input.linkGeneration)||input.linkGeneration<1||![input.wabaId,input.phoneNumberId].every(x=>/^[0-9]{1,64}$/.test(x))||!/^\d{7,15}$/.test(input.recipientWaId)||!input.waMessageId||input.waMessageId.length>512||/[\s\u0000-\u001f]/.test(input.waMessageId)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.occurredAt)||!Number.isFinite(Date.parse(input.occurredAt)))return fail("INVALID_INPUT");
 try{
  const {data,error}=await client.rpc("whatsapp_record_coexistence_outbound_proof",{p_waba_id:input.wabaId,p_phone_number_id:input.phoneNumberId,p_wa_message_id:input.waMessageId,p_status:input.status,p_recipient_wa_id:input.recipientWaId,p_occurred_at:input.occurredAt});
  const row=object(data);if(error||!row)return fail();if(row.ok!==true)return failure(row);
  if(row.verified===false)return {ok:true,verified:false};
  if(row.verified!==true||row.company_id!==input.companyId||row.link_id!==input.linkId||row.link_generation!==input.linkGeneration)return fail();
  return {ok:true,verified:true};
 }catch{return fail();}
}
/** Bounded local projection recovery. It never retries a Meta operation. */
export async function reconcileCoexistenceEvents(client:CoexistenceIngressClient,companyId:string):Promise<{ok:true;processed:number;recovered:number;pending:number;conflicts:number;remaining:number}|Failure>{
 if(!uuid(companyId))return fail("INVALID_INPUT");
 try{
  const {data,error}=await client.rpc("whatsapp_reconcile_coexistence_events",{p_company_id:companyId.toLowerCase(),p_limit:50});
  const row=object(data);if(error||!row)return fail();if(row.ok!==true)return failure(row);
  if(row.company_id!==companyId.toLowerCase()||!count(row.processed)||row.processed>50||!count(row.recovered)||!count(row.pending)||row.recovered+row.pending>row.processed||!count(row.conflicts)||!count(row.remaining))return fail();
  return {ok:true,processed:row.processed,recovered:row.recovered,pending:row.pending,conflicts:row.conflicts,remaining:row.remaining};
 }catch{return fail();}
}

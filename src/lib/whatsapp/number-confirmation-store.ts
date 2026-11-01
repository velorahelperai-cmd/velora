import type {OwnerRpcClient} from "./coexistence/owner-auth";

export type NumberConfirmationStatus="not_required"|"pending"|"confirmed"|"rejected";
export type NumberConfirmationRead={ok:true;status:NumberConfirmationStatus;linkId?:string;linkGeneration?:number;displayNumber?:string|null}|{ok:false;code:string};
export type NumberConfirmationDecision={ok:true;status:"confirmed"|"rejected";replayed:boolean;disconnected:boolean}|{ok:false;code:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES=new Set(["not_required","pending","confirmed","rejected"]);
const code=(value:unknown)=>typeof value==="string"&&/^[A-Z_]{1,40}$/.test(value)?value:"UNAVAILABLE";

/** Server-persisted "is this your number" state. Sending is gated in Postgres, not here. */
export async function readNumberConfirmationStore(client:OwnerRpcClient,companyId:string):Promise<NumberConfirmationRead>{
 try{
  const {data,error}=await client.rpc("whatsapp_read_number_confirmation",{p_company_id:companyId});
  if(error||!data||typeof data!=="object")return {ok:false,code:"UNAVAILABLE"};
  const row=data as Record<string,unknown>;
  if(row.ok!==true)return {ok:false,code:code(row.code)};
  if(typeof row.status!=="string"||!STATUSES.has(row.status))return {ok:false,code:"UNAVAILABLE"};
  if(row.status==="not_required")return {ok:true,status:"not_required"};
  if(typeof row.link_id!=="string"||!UUID.test(row.link_id)||!Number.isSafeInteger(row.link_generation))return {ok:false,code:"UNAVAILABLE"};
  return {ok:true,status:row.status as NumberConfirmationStatus,linkId:row.link_id.toLowerCase(),linkGeneration:row.link_generation as number,displayNumber:typeof row.display_number==="string"?row.display_number:null};
 }catch{return {ok:false,code:"UNAVAILABLE"};}
}

export async function decideNumberConfirmationStore(client:OwnerRpcClient,input:{companyId:string;linkId:string;linkGeneration:number;answer:"confirmed"|"rejected"}):Promise<NumberConfirmationDecision>{
 if(!UUID.test(input.companyId)||!UUID.test(input.linkId)||!Number.isSafeInteger(input.linkGeneration)||(input.answer!=="confirmed"&&input.answer!=="rejected"))return {ok:false,code:"INVALID_INPUT"};
 try{
  const {data,error}=await client.rpc("whatsapp_decide_number_confirmation",{p_company_id:input.companyId,p_link_id:input.linkId,p_link_generation:input.linkGeneration,p_answer:input.answer});
  if(error||!data||typeof data!=="object")return {ok:false,code:"UNAVAILABLE"};
  const row=data as Record<string,unknown>;
  if(row.ok!==true||(row.status!=="confirmed"&&row.status!=="rejected"))return {ok:false,code:code(row.code)};
  return {ok:true,status:row.status,replayed:row.replayed===true,disconnected:row.disconnected===true};
 }catch{return {ok:false,code:"UNAVAILABLE"};}
}

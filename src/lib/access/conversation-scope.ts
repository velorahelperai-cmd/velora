import {createClient} from "@/lib/supabase/server";
import {reportInboxReadFailure} from "@/lib/whatsapp/inbox-diagnostics";
import type {ConversationScope} from "./capabilities";

export type ConversationScopeRead =
 | {ok:true;scope:ConversationScope}
 | {ok:false;code:"FORBIDDEN"|"UNAVAILABLE"};

/** Internal server reader, not a server action. Exact null is a successful denial contract. */
export async function readSessionConversationScope(companyId:string):Promise<ConversationScopeRead>{
 try{
  const client=await createClient();
  const {data,error}=await client.rpc("company_conversation_scope",{p_company_id:companyId});
  if(error){reportInboxReadFailure("scope_rpc","RPC_ERROR",error);return {ok:false,code:"UNAVAILABLE"};}
  if(data==="all_company"||data==="assigned_only")return {ok:true,scope:data};
  if(data===null){reportInboxReadFailure("scope_rpc","NULL_RESULT");return {ok:false,code:"FORBIDDEN"};}
  reportInboxReadFailure("scope_rpc","INVALID_RESPONSE");return {ok:false,code:"UNAVAILABLE"};
 }catch(error){reportInboxReadFailure("scope_rpc","EXCEPTION",error);return {ok:false,code:"UNAVAILABLE"};}
}

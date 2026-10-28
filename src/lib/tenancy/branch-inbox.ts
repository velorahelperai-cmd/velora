"use server";
import {readSessionIdentity} from "@/lib/auth/server-identity";
import {createClient} from "@/lib/supabase/server";
export type BranchAccess={companyId:string;branchId:string;branchLabel:string;capabilities:string[]};
export type BranchMessage={id:string;text:string;direction:string;receivedAt:string};
export type BranchConversation={id:string;label:string;latest:BranchMessage|null};
export type BranchInbox={conversations:BranchConversation[];conversation:BranchConversation|null;messages:BranchMessage[];nextCursor:string|null};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const record=(v:unknown):Record<string,unknown>|null=>!!v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const cursor=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=BigInt('9223372036854775807');
async function rpc(name:string,args:Record<string,unknown>){const client=await createClient();const r=await client.rpc(name as never,args as never);return r.error?null:record(r.data);}
async function authenticated(){const identity=await readSessionIdentity();return identity.ok&&identity.emailConfirmed;}
export async function listMyBranchAccess():Promise<BranchAccess[]|null>{
 try{
  if(!await authenticated())return null;
  const data=await rpc('es02_list_my_branch_access',{});if(data?.ok!==true||!Array.isArray(data.branches))return null;
  const branches:BranchAccess[]=[];
  for(const value of data.branches){const row=record(value);if(!row||!uuid(row.companyId)||!uuid(row.branchId)||typeof row.branchLabel!=='string'||!Array.isArray(row.capabilities)||!row.capabilities.every(c=>['wa.conversations.read','ig.conversations.read'].includes(c)))return null;
   branches.push({companyId:row.companyId,branchId:row.branchId,branchLabel:row.branchLabel,capabilities:[...row.capabilities]});}
  return branches;
 }catch{return null;}
}
function message(value:unknown,channel:string):BranchMessage|null{
 const row=record(value);if(!row||!uuid(row.id)||!['inbound','outbound'].includes(String(row.direction))||typeof row.received_at!=='string'||!Number.isFinite(Date.parse(row.received_at)))return null;
 const body=channel==='whatsapp'?row.body:row.content_text;if(body!==null&&typeof body!=='string')return null;
 return {id:row.id,text:body??'',direction:String(row.direction),receivedAt:row.received_at};
}
function conversation(value:unknown,channel:string):BranchConversation|null{
 const row=record(value);if(!row||!uuid(row.id))return null;
 const label=channel==='whatsapp'?(row.customer_name||row.customer_wa_id):row.counterparty_id;
 if(typeof label!=='string')return null;
 const latest=row.latest_message===null?null:message(row.latest_message,channel);if(row.latest_message!==null&&!latest)return null;
 return {id:row.id,label,latest};
}
export async function readBranchInbox(input:{companyId:string;branchId:string;channel:string;conversationId?:string;before?:string}):Promise<BranchInbox|null>{
 try{
  if(!input||!uuid(input.companyId)||!uuid(input.branchId)||!['whatsapp','instagram'].includes(input.channel)||(input.conversationId!==undefined&&!uuid(input.conversationId))||(input.before!==undefined&&!cursor(input.before)))return null;
  if(!await authenticated())return null;
  const data=await rpc('es02_read_branch_inbox',{p_company_id:input.companyId,p_branch_id:input.branchId,p_channel:input.channel,p_conversation_id:input.conversationId??null,p_before:input.before??null,p_limit:50});
  if(data?.ok!==true||data.companyId!==input.companyId||data.branchId!==input.branchId||data.channel!==input.channel||typeof data.has_more!=='boolean'||(data.next_cursor!==null&&!cursor(data.next_cursor)))return null;
  const selected=input.conversationId?conversation(data.conversation,input.channel):null;
  if(input.conversationId&&selected?.id!==input.conversationId)return null;
  const rawRows=input.conversationId?data.messages:data.conversations;if(!Array.isArray(rawRows))return null;
  const conversations:BranchConversation[]=[],messages:BranchMessage[]=[];
  for(const row of rawRows){if(input.conversationId){const parsed=message(row,input.channel);if(!parsed)return null;messages.push(parsed);}else{const parsed=conversation(row,input.channel);if(!parsed)return null;conversations.push(parsed);}}
  if(data.has_more&&!cursor(data.next_cursor))return null;
  return {conversations,conversation:selected,messages,nextCursor:data.has_more?data.next_cursor as string:null};
 }catch{return null;}
}

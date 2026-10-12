import 'server-only';
import type {InstagramRpcClient} from './connection-store';
import type {InstagramAssignInput,InstagramAssignment,InstagramConversation,InstagramInboxBinding,InstagramInboxFailureCode,InstagramInboxPage,InstagramInboxResult,InstagramMessage,InstagramPage,InstagramPageInput,InstagramReadInput,InstagramReadResult,InstagramThreadInput,InstagramThreadPage} from './inbox-contracts';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sequence=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=BigInt('9223372036854775807');
const time=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const count=(v:unknown):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw Error('INVALID_COUNT');return v;};
const validPage=(v:InstagramPageInput)=>object(v)&&uuid(v.companyId)&&(v.limit===undefined||Number.isInteger(v.limit)&&v.limit>=1&&v.limit<=100)&&(v.cursor===undefined||v.cursor===null||uuid(v.cursor));
const failure=(code:InstagramInboxFailureCode)=>({ok:false as const,code});
function page(r:Record<string,unknown>):InstagramPage{if(typeof r.has_more!=='boolean'||r.next_cursor!==null&&!uuid(r.next_cursor)||r.has_more!==(r.next_cursor!==null))throw Error('INVALID_PAGE');return {hasMore:r.has_more,nextCursor:r.next_cursor as string|null};}
function binding(r:Record<string,unknown>,companyId:string):InstagramInboxBinding{if(r.company_id!==companyId||!uuid(r.actor_id)||!['all_company','assigned_only'].includes(String(r.conversation_scope)))throw Error('INVALID_BINDING');return {companyId,actorId:r.actor_id,conversationScope:r.conversation_scope as InstagramInboxBinding['conversationScope']};}
function message(v:unknown):InstagramMessage{if(!object(v)||!uuid(v.id)||!sequence(v.arrival_sequence)||!['inbound','outbound'].includes(String(v.direction))||!time(v.received_at)||v.read_observed_at!==null&&!time(v.read_observed_at))throw Error('INVALID_MESSAGE');
 const content=v.content_kind==='non_text'&&v.content_text===null?{kind:'non_text' as const}:v.content_kind==='text'&&typeof v.content_text==='string'&&v.content_text.length?{kind:'text' as const,text:v.content_text}:null;if(!content)throw Error('INVALID_CONTENT');
 return {id:v.id,arrivalSequence:v.arrival_sequence,direction:v.direction as InstagramMessage['direction'],content,receivedAt:v.received_at,readObservedAt:v.read_observed_at as string|null};}
function conversation(v:unknown):InstagramConversation{if(!object(v)||!uuid(v.id)||!sequence(v.inbox_sequence)||typeof v.account_id!=='string'||!/^\d{1,64}$/.test(v.account_id)||typeof v.counterparty_id!=='string'||!/^\d{1,64}$/.test(v.counterparty_id)||v.assigned_to!==null&&!uuid(v.assigned_to)||v.last_received_at!==null&&!time(v.last_received_at)||count(v.revision)<1)throw Error('INVALID_CONVERSATION');
 return {id:v.id,inboxSequence:v.inbox_sequence,accountId:v.account_id,counterpartyId:v.counterparty_id,assignedTo:v.assigned_to as string|null,revision:v.revision as number,unreadCount:count(v.unread_count),lastReceivedAt:v.last_received_at as string|null,latestMessage:v.latest_message===null?null:message(v.latest_message)};}
/** Inject only the native session client, never service_role. Each RPC independently
 * rechecks membership, session, IG capability and scope in the transaction. */
export function createInstagramInboxStore(session:InstagramRpcClient){
 async function rpc<T>(name:string,args:Record<string,unknown>,parse:(r:Record<string,unknown>)=>T):Promise<InstagramInboxResult<T>>{
  try{const r=await session.rpc(name,args);if(r.error||!object(r.data))return failure('UNAVAILABLE');if(r.data.ok===false){const code=r.data.code;return failure(['FORBIDDEN','NOT_FOUND','SCOPE_CHANGED','INVALID_INPUT','CONFLICT','UNAVAILABLE'].includes(String(code))?code as InstagramInboxFailureCode:'UNAVAILABLE');}if(r.data.ok!==true)return failure('UNAVAILABLE');return {ok:true,data:parse(r.data)};}catch{return failure('UNAVAILABLE');}
 }
 return {
  async inbox(input:InstagramPageInput):Promise<InstagramInboxResult<InstagramInboxPage>>{
   if(!validPage(input))return failure('INVALID_INPUT');const {limit=50}=input;const companyId=input.companyId.toLowerCase(),cursor=input.cursor?.toLowerCase()??null;
   return rpc('instagram_inbox_page',{p_company_id:companyId,p_limit:limit,p_cursor:cursor},r=>{if(!Array.isArray(r.conversations))throw Error('INVALID_ROWS');return {...binding(r,companyId),...page(r),conversations:r.conversations.map(conversation),total:count(r.total),unreadTotal:count(r.unread_total)};});
  },
  async thread(input:InstagramThreadInput):Promise<InstagramInboxResult<InstagramThreadPage>>{
   if(!validPage(input)||!uuid(input.conversationId))return failure('INVALID_INPUT');const {limit=50}=input;const companyId=input.companyId.toLowerCase(),conversationId=input.conversationId.toLowerCase(),cursor=input.cursor?.toLowerCase()??null;
   return rpc('instagram_thread_page',{p_company_id:companyId,p_conversation_id:conversationId,p_limit:limit,p_cursor:cursor},r=>{if(r.conversation_id!==conversationId||!Array.isArray(r.messages)||r.read_receipt!==null&&!uuid(r.read_receipt)||cursor!==null&&r.read_receipt!==null)throw Error('INVALID_THREAD');const c=conversation(r.conversation);if(c.id!==conversationId)throw Error('INVALID_CONVERSATION');const messages=r.messages.map(message);if(r.read_receipt!==null&&!messages.some(m=>m.direction==='inbound'))throw Error('INVALID_READ_RECEIPT');return {...binding(r,companyId),...page(r),conversationId,conversation:c,messages,readReceipt:r.read_receipt as string|null,unreadCount:count(r.unread_count)};});
  },
  async markRead(input:InstagramReadInput):Promise<InstagramInboxResult<InstagramReadResult>>{
   if(!object(input)||![input.companyId,input.conversationId,input.readReceipt].every(uuid))return failure('INVALID_INPUT');const companyId=input.companyId.toLowerCase(),conversationId=input.conversationId.toLowerCase(),readReceipt=input.readReceipt.toLowerCase();
   return rpc('instagram_mark_thread_read',{p_company_id:companyId,p_conversation_id:conversationId,p_read_receipt:readReceipt},r=>{if(r.conversation_id!==conversationId||!sequence(r.last_read_sequence))throw Error('INVALID_READ');return {...binding(r,companyId),conversationId,lastReadSequence:r.last_read_sequence,unreadCount:count(r.unread_count)};});
  },
  async assign(input:InstagramAssignInput):Promise<InstagramInboxResult<InstagramAssignment>>{
   if(!object(input)||![input.companyId,input.conversationId].every(uuid)||input.assignedTo!==null&&!uuid(input.assignedTo)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||input.expectedRevision>=2147483647)return failure('INVALID_INPUT');const {expectedRevision}=input;const companyId=input.companyId.toLowerCase(),conversationId=input.conversationId.toLowerCase(),assignedTo=input.assignedTo?.toLowerCase()??null;
   return rpc('instagram_assign_conversation',{p_company_id:companyId,p_conversation_id:conversationId,p_assigned_to:assignedTo,p_expected_revision:expectedRevision},r=>{if(r.conversation_id!==conversationId||r.assigned_to!==assignedTo||count(r.revision)!==expectedRevision+1)throw Error('INVALID_ASSIGNMENT');return {...binding(r,companyId),conversationId,assignedTo,revision:r.revision as number};});
  },
 };
}

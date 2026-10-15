'use server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {requireVerifiedUser,getCompanyAccess} from '@/lib/tenancy/access';
import {loadWhatsappThreadPage} from '@/lib/whatsapp/inbox-contracts';
import {loadInstagramThreadPage} from '@/lib/instagram/inbox-actions';
import {runAdminAITrial} from './runtime/admin-actions';
import {verifyAnswerCitationsStillValid} from './context';
import type {AIModelId,AnswerCitation} from './types';
import {generateChannelDraft,type ChannelDraftFrame,type ChannelDraftInput,type ChannelDraftRef} from './channel-draft';

const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const valid=(v:ChannelDraftRef)=>v&&uuid(v.companyId)&&uuid(v.conversationId)&&['whatsapp','instagram'].includes(v.channel);
const fail=(code:string)=>({ok:false as const,code});
function draftModel():AIModelId|null{
 const model=process.env.AI_CHANNEL_DRAFT_MODEL??'gpt-6-luna';
 return ['gpt-6-luna','gpt-6.1-sol','gemini-3.8-flash'].includes(model)?model as AIModelId:null;
}
function latestInbound<T extends {direction:string;arrivalSequence:string}>(messages:readonly T[]){return messages.filter(m=>m.direction==='inbound').reduce<T|null>((latest,m)=>!latest||BigInt(m.arrivalSequence)>BigInt(latest.arrivalSequence)?m:latest,null);}
async function owner(){
 const gate=await requireVerifiedUser();if(!gate.ok)return null;
 const session=await createClient();const result=await session.rpc('is_platform_owner');
 return !result.error&&result.data===true?gate.context.userId:null;
}
async function frame(ref:ChannelDraftRef):Promise<ChannelDraftFrame|null>{
 const access=await getCompanyAccess();
 if(!access.ok||access.context.company?.id!==ref.companyId||access.context.company.status==='suspended')return null;
 if(ref.channel==='instagram'){
  const page=await loadInstagramThreadPage({...ref,limit:100});if(!page.ok)return null;
  const message=latestInbound(page.data.messages);
  if(!message||message.content.kind!=='text')return null;
  return {...ref,messageId:message.id,question:message.content.text,binding:JSON.stringify([page.data.conversation.accountId,page.data.conversation.counterpartyId,page.data.conversation.revision])};
 }
 const page=await loadWhatsappThreadPage({...ref,limit:100});if(!page.ok)return null;
 const message=latestInbound(page.data.messages);if(!message)return null;
 // The display body can contain media placeholders. Verify the native stored type.
 const session=await createClient();
 const {data,error}=await session.from('whatsapp_messages').select('body,message_type').eq('company_id',ref.companyId).eq('conversation_id',ref.conversationId).eq('id',message.id).maybeSingle();
 if(error||!data||data.message_type!=='text'||!data.body?.trim())return null;
 const c=page.data.conversation;
 return {...ref,messageId:message.id,question:data.body,binding:JSON.stringify([c.automationGeneration,c.revision,c.assignedTo??null])};
}
function store(){return createAdminClient() as SupabaseClient|null;}
async function existing(db:SupabaseClient,ref:ChannelDraftRef,actorId:string){
 return db.from('ai_channel_review_drafts').select('execution_id,message_id,binding,status,response_text,error_code,citations').eq('company_id',ref.companyId).eq('actor_id',actorId).eq('channel',ref.channel).eq('conversation_id',ref.conversationId).order('created_at',{ascending:false}).limit(1).maybeSingle();
}
async function validCitations(companyId:string,citations:unknown){
 if(!Array.isArray(citations)||!citations.length||citations.some(c=>!c||typeof c.sourceId!=='string'||typeof c.title!=='string'||!Number.isSafeInteger(c.contentVersion)||c.contentVersion<1))return false;
 const db=createAdminClient();return !!db&&await verifyAnswerCitationsStillValid(companyId,(citations as AnswerCitation[]).map(c=>({...c,text:'saved draft citation'})),db);
}
/** Read-only. Never imports or executes a provider operation as a readiness test. */
export async function readChannelAIDraft(input:ChannelDraftRef){
 if(!valid(input))return fail('INVALID_INPUT');const ref={companyId:input.companyId.toLowerCase(),conversationId:input.conversationId.toLowerCase(),channel:input.channel};
 try{
  if(process.env.AI_CHANNEL_DRAFTS_ENABLED!=='true')return fail('DRAFTS_DISABLED');
  if(!draftModel())return fail('DRAFT_MODEL_NOT_CONFIGURED');
  const actorId=await owner();if(!actorId)return fail('OWNER_REQUIRED');
  const current=await frame(ref);if(!current)return fail('TEXT_INBOUND_REQUIRED');
  const db=store();if(!db)return fail('UNAVAILABLE');
  const saved=await existing(db,ref,actorId);if(saved.error)return fail('UNAVAILABLE');
  const draft=saved.data?.message_id===current.messageId&&saved.data?.binding===current.binding?saved.data:null;
  if(draft?.status==='ready'&&!await validCitations(ref.companyId,draft.citations))return fail('KNOWLEDGE_CHANGED');
  return {ok:true as const,messageId:current.messageId,text:draft?.status==='ready'?String(draft.response_text):null,requested:!!draft,errorCode:draft?.error_code as string|null};
 }catch{return fail('UNAVAILABLE');}
}
/** Native inbound -> existing owner trial/1 OMR ledger -> durable review draft.
 * No Meta transport, send claim, webhook or worker is called from this action. */
export async function prepareChannelAIDraft(input:ChannelDraftInput){
 if(!valid(input)||!uuid(input.messageId)||!uuid(input.executionId))return fail('INVALID_INPUT');
 const captured={companyId:input.companyId.toLowerCase(),conversationId:input.conversationId.toLowerCase(),channel:input.channel,messageId:input.messageId.toLowerCase(),executionId:input.executionId.toLowerCase(),executeConfirmed:input.executeConfirmed===true};
 if(process.env.AI_CHANNEL_DRAFTS_ENABLED!=='true')return fail('DRAFTS_DISABLED');
 const model=draftModel();if(!model)return fail('DRAFT_MODEL_NOT_CONFIGURED');
 let actorId:string|null=null,citations:AnswerCitation[]=[];
 return generateChannelDraft(captured,{
  authorize:async()=>{const id=await owner();if(!id||actorId&&actorId!==id)return false;actorId=id;return true;},
  frame:()=>frame(captured),
  claim:async f=>{
   const db=store();if(!db||!actorId)return {kind:'blocked'};
   const inserted=await db.from('ai_channel_review_drafts').insert({execution_id:captured.executionId,company_id:f.companyId,actor_id:actorId,channel:f.channel,conversation_id:f.conversationId,message_id:f.messageId,binding:f.binding});
   if(!inserted.error)return {kind:'claimed'};
   if(inserted.error.code!=='23505')return {kind:'blocked'};
   const saved=await existing(db,f,actorId);const d=saved.data;
   return !saved.error&&d?.execution_id===captured.executionId&&d.message_id===f.messageId&&d.binding===f.binding&&d.status==='ready'&&typeof d.response_text==='string'&&await validCitations(f.companyId,d.citations)?{kind:'existing',text:d.response_text}:{kind:'blocked'};
  },
  trial:async f=>{
   const result=await runAdminAITrial({companyId:f.companyId,question:f.question,executionId:captured.executionId,model,locale:'ar',contextMode:'company',maxOutputTokens:f.channel==='instagram'?160:512,maxCostBaisa:model==='gemini-3.8-flash'?1000:100});
   if(result.ok)citations=result.citations;
   return result.ok?{ok:true,text:result.text,complete:result.complete}:{ok:false,error:result.error};
  },
  save:async(f,id,text)=>{
   const db=store();if(!db||!actorId||!await validCitations(f.companyId,citations))return false;
   const r=await db.from('ai_channel_review_drafts').update({status:'ready',response_text:text,citations}).eq('execution_id',id).eq('actor_id',actorId).eq('company_id',f.companyId).eq('message_id',f.messageId).eq('binding',f.binding).eq('status','generating').select('execution_id');
   return !r.error&&r.data?.length===1;
  },
  fail:async(id,code)=>{const db=store();if(!db||!actorId)return;await db.from('ai_channel_review_drafts').update({status:'failed',error_code:code}).eq('execution_id',id).eq('actor_id',actorId).eq('status','generating');},
 });
}

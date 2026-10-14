export type ChannelDraftChannel='whatsapp'|'instagram';
export type ChannelDraftRef={companyId:string;channel:ChannelDraftChannel;conversationId:string};
export type ChannelDraftFrame=ChannelDraftRef&{messageId:string;question:string;binding:string};
export type ChannelDraftInput=ChannelDraftRef&{messageId:string;executionId:string;executeConfirmed:boolean};
export type ChannelDraftResult={ok:true;text:string}|{ok:false;code:string};
export type ChannelDraftPorts={
 authorize():Promise<boolean>;
 frame():Promise<ChannelDraftFrame|null>;
 claim(frame:ChannelDraftFrame,executionId:string):Promise<{kind:'claimed'}|{kind:'existing';text:string}|{kind:'blocked'}>;
 trial(frame:ChannelDraftFrame,executionId:string):Promise<{ok:true;text:string;complete:boolean}|{ok:false;error:string}>;
 save(frame:ChannelDraftFrame,executionId:string,text:string):Promise<boolean>;
 fail(executionId:string,code:string):Promise<void>;
};
export async function generateChannelDraft(input:ChannelDraftInput,ports:ChannelDraftPorts):Promise<ChannelDraftResult>{
 const denied=(code:string):ChannelDraftResult=>({ok:false,code});
 if(input.executeConfirmed!==true)return denied('CONFIRMATION_REQUIRED');
 let claimed=false;
 const failed=async(code:string)=>{if(claimed)await ports.fail(input.executionId,code);return denied(code);};
 try{
  if(!await ports.authorize())return denied('OWNER_REQUIRED');
  const frame=await ports.frame();
  if(!frame)return denied('TEXT_INBOUND_REQUIRED');
  if(frame.companyId!==input.companyId||frame.channel!==input.channel||frame.conversationId!==input.conversationId||frame.messageId!==input.messageId)return denied('MESSAGE_CHANGED');
  const claim=await ports.claim(frame,input.executionId);
  if(claim.kind==='existing')return {ok:true,text:claim.text};
  if(claim.kind!=='claimed')return denied('DRAFT_ALREADY_REQUESTED');
  claimed=true;
  const answer=await ports.trial(frame,input.executionId);
  if(!answer.ok)return failed(answer.error);
  if(!answer.complete||!answer.text.trim())return failed('ANSWER_INCOMPLETE');
  if(frame.channel==='instagram'?new TextEncoder().encode(answer.text).length>1000:answer.text.length>4096)return failed('REPLY_TOO_LONG');
  if(!await ports.authorize())return failed('OWNER_REQUIRED');
  const current=await ports.frame();
  if(!current||Object.keys(frame).some(key=>current[key as keyof ChannelDraftFrame]!==frame[key as keyof ChannelDraftFrame]))return failed('MESSAGE_CHANGED');
  if(!await ports.save(frame,input.executionId,answer.text))return failed('DRAFT_SAVE_FAILED');
  return {ok:true,text:answer.text};
 }catch{
  if(claimed){try{await ports.fail(input.executionId,'DRAFT_REQUIRES_REVIEW');}catch{/* The durable claim remains; never repeat a paid attempt. */}}
  return denied('UNAVAILABLE');
 }
}

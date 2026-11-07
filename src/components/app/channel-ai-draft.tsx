'use client';
import {useEffect,useRef,useState,useTransition} from 'react';
import {readChannelAIDraft,prepareChannelAIDraft} from '@/lib/answers/channel-draft-actions';
import type {ChannelDraftRef} from '@/lib/answers/channel-draft';
import {Button,Notice} from './ui';

const messages:Record<string,[string,string]>={
 OWNER_REQUIRED:['Administrative AI trials require the platform owner.','تجارب AI الإدارية متاحة لمالك المنصة فقط.'],
 DRAFT_MODEL_NOT_CONFIGURED:['The draft model needs a valid server configuration.','يلزم تحديد نموذج المسودات الصحيح على السيرفر.'],
 TEXT_INBOUND_REQUIRED:['A received text message is required before preparing a reply.','يلزم وجود رسالة نصية واردة قبل تجهيز الرد.'],
 MESSAGE_CHANGED:['The message or account changed. Refresh before continuing.','تغيّرت الرسالة أو الحساب. حدّث المحادثة قبل المتابعة.'],
 BUDGET_EXCEEDED:['The shared 1 OMR trial budget has been reached.','وصلت التجارب إلى الحد المشترك البالغ ١ ريال.'],
 BUDGET_DISABLED:['The owner trial budget is disabled.','ميزانية تجارب المالك مقفلة.'],
 DRAFT_ALREADY_REQUESTED:['A trial was already requested for this message. Refresh to read its result; it will not run again.','طُلبت تجربة لهذه الرسالة بالفعل. حدّث لقراءة النتيجة؛ لن نكرر الاستدعاء.'],
 REPLY_TOO_LONG:['The generated reply exceeds this platform’s limit. It was not sent.','الرد الناتج يتجاوز حد المنصة. لم يُرسل.'],
 NO_KNOWLEDGE:['Approve business information before preparing an AI reply.','اعتمد معلومات النشاط قبل تجهيز رد AI.'],
 KNOWLEDGE_CHANGED:['The approved business information changed. This saved draft is no longer available.','تغيّرت معلومات النشاط المعتمدة. هذه المسودة المحفوظة لم تعد متاحة.'],
 ANSWER_INCOMPLETE:['The model returned an incomplete answer. Review the owner trial console.','أعاد النموذج ردًا غير مكتمل. راجع لوحة تجارب المالك.'],
};
export function ChannelAIDraft({companyId,channel,conversationId,ar,disabled=false,onUse}:ChannelDraftRef&{ar:boolean;disabled?:boolean;onUse(text:string):void}){
 const [state,setState]=useState<Awaited<ReturnType<typeof readChannelAIDraft>>|null>(null);
 const [confirmed,setConfirmed]=useState(false),[error,setError]=useState<string|null>(null),[busy,startTransition]=useTransition();
 const epoch=useRef(0),operation=useRef<{messageId:string;id:string}|null>(null),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const fence=epoch,current=++fence.current;
  void readChannelAIDraft({companyId,channel,conversationId}).then(result=>{if(current===fence.current)setState(result);}).catch(()=>{if(current===fence.current)setError('UNAVAILABLE');});
  return()=>{fence.current++;};
 },[companyId,channel,conversationId,refresh]);
 const notice=(code:string)=>messages[code]?.[ar?1:0]??(ar?'تعذّر تجهيز المسودة. راجع لوحة تجارب المالك لمعرفة النتيجة قبل طلب تجربة جديدة.':'Draft preparation failed. Check the owner trial console before requesting another trial.');
 if(state&&!state.ok&&['DRAFTS_DISABLED','OWNER_REQUIRED','FORBIDDEN'].includes(state.code))return null;
 function generate(){
  if(!state?.ok||!confirmed||busy||disabled||state.requested)return;
  const current=epoch.current,executionId=operation.current?.messageId===state.messageId?operation.current.id:crypto.randomUUID();operation.current={messageId:state.messageId,id:executionId};
  startTransition(async()=>{
   try{
    const result=await prepareChannelAIDraft({companyId,channel,conversationId,messageId:state.messageId,executionId,executeConfirmed:true});
    if(current!==epoch.current)return;
    if(result.ok)setState({...state,text:result.text,requested:true,errorCode:null});
    else{setError(result.code);setRefresh(n=>n+1);}
   }catch{if(current===epoch.current){setError('UNAVAILABLE');setRefresh(n=>n+1);}}
  });
 }
 function useDraft(){
  if(!state?.ok||!state.text||disabled||busy)return;
  const current=epoch.current;
  startTransition(async()=>{try{
   const latest=await readChannelAIDraft({companyId,channel,conversationId});if(current!==epoch.current)return;
   setState(latest);
   if(latest.ok&&typeof latest.text==='string'&&latest.messageId===state.messageId&&latest.text===state.text)onUse(latest.text);
   else{setConfirmed(false);setError(latest.ok?'MESSAGE_CHANGED':latest.code);}
  }catch{if(current===epoch.current)setError('UNAVAILABLE');}});
 }
 return <section aria-label={ar?'مسودة رد AI':'AI reply draft'} className="mb-3 grid gap-2 rounded-xl border border-[color:var(--color-border-soft)] p-3 text-sm">
  <h3 className="font-bold">{ar?'تجهيز رد AI للمراجعة':'Prepare an AI reply for review'}</h3>
  <p>{ar?'لن تُرسل المسودة. الضغط على «تجهيز الرد» يشغّل النموذج ويُحسب ضمن ميزانية تجارب المالك المشتركة: ١ ريال إجمالًا.':'This draft will not be sent. Preparing it calls the model and uses the shared owner trial budget of 1 OMR in total.'}</p>
  {!state?<p aria-busy="true">{ar?'جارٍ فحص الجاهزية…':'Checking readiness…'}</p>:!state.ok?<Notice>{notice(state.code)}</Notice>:state.text?<>
   <p role="status" className="whitespace-pre-wrap">{state.text}</p>
   <Button type="button" disabled={disabled||busy} onClick={useDraft}>{ar?'استخدام المسودة في خانة الرد':'Use draft in reply field'}</Button>
  </>:state.requested?<Notice>{notice(state.errorCode??'DRAFT_ALREADY_REQUESTED')}</Notice>:<>
   <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={disabled||busy} onChange={e=>setConfirmed(e.target.checked)}/>{ar?'أوافق على تشغيل تجربة AI المدفوعة لتجهيز هذا الرد فقط.':'I approve a paid AI trial to prepare this reply only.'}</label>
   <Button type="button" disabled={!confirmed||disabled||busy} onClick={generate}>{busy?(ar?'جارٍ تجهيز الرد…':'Preparing reply…'):(ar?'تجهيز الرد':'Prepare reply')}</Button>
  </>}
  {error&&<Notice tone="error">{notice(error)}</Notice>}
  <Button type="button" disabled={busy||disabled} onClick={()=>{setError(null);setRefresh(n=>n+1);}}>{ar?'تحديث المسودة المحفوظة':'Refresh saved draft'}</Button>
 </section>;
}

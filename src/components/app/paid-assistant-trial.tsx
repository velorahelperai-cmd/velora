"use client";
import {useEffect,useId,useLayoutEffect,useRef,useState,type FormEvent,type KeyboardEvent} from "react";
import {ANSWER_MAX_QUESTION_CHARS} from "@/lib/answers/constants";
import type {AnswerFailure,AnswerResult} from "@/lib/answers/types";
import {businessTypes} from "@/lib/business-types";
import type {SubscriptionPersona} from "./subscription-offers-view";
import {PERSONA_NAMES,PERSONA_POSTERS} from "./setup-order-review-model";
import styles from "./paid-assistant-trial.module.css";

export type TrialScope={expectedAccountId:string;companyId:string;branchId:string};
type TrialContext=TrialScope & {expectedVersion:number;knowledgeRevision:string;operationId?:string};
export type TrialMessage={id:string;executionId?:string|null;scope:TrialScope;version:number;knowledgeRevision:string;question:string;result:AnswerResult|Pick<Extract<AnswerResult,{ok:true}>,"ok"|"text"|"citations"|"modelId">;origin:"engine"|"synthetic"};
/** UI-only host projection; neither an answer nor local acknowledgement grants readiness. */
export type TrialSnapshot={scope:TrialScope;version:number;knowledgeRevision:string;branchLabel:string;businessType:string;canAsk:boolean|null;handoffPreview?:"human_request"|"sensitive";recoveryNotice?:"context_changed";trialAllowance?:{limit:number;used:number};pendingOperation?:{id:string;status:string;recoverable:boolean}|null;messages:TrialMessage[]};
export type PaidAssistantTrialProps={
 onRecover?:(operationId:string)=>void|Promise<void>;
 onRefresh?:()=>void|Promise<void>;
 locale:"ar"|"en";scope:TrialScope;boundaryFingerprint:string;snapshot:TrialSnapshot|null;
 /** Purchased assistant identity from the authoritative setup read. Never invented. */
 persona?:SubscriptionPersona|null;
 state:{scope:TrialScope;version:number|null;phase:"loading"|"ready"|"pending"|"error"|"unknown"|"unavailable";requestId:string|null;failure:AnswerFailure|null;canRetry:boolean|null};
 isCurrent:()=>boolean;onAsk?:(input:TrialContext & {question:string})=>void|Promise<void>;onRetry?:(input:TrialContext & {requestId:string})=>void|Promise<void>;
};
const same=(a:TrialScope,b:TrialScope)=>!!a.expectedAccountId&&!!a.companyId&&!!a.branchId&&a.expectedAccountId===b.expectedAccountId&&a.companyId===b.companyId&&a.branchId===b.branchId;
export const trialViewKey=(p:PaidAssistantTrialProps)=>JSON.stringify([p.scope.expectedAccountId,p.scope.companyId,p.scope.branchId,p.boundaryFingerprint,p.snapshot?.version,p.snapshot?.knowledgeRevision]);
const questions:Record<string,readonly [string,string][]>={
 food:[["ما الأصناف المتاحة؟","What items are available?"],["كيف أطلب الطعام؟","How can I place a food order?"]],
 retail:[["هل المنتج الذي أبحث عنه متوفر؟","Is the product I need available?"],["ما سياسة الاستبدال والإرجاع؟","What is your exchange and return policy?"]],
 education:[["ما الدورات أو البرامج المتاحة؟","Which courses or programs are available?"],["كيف أسجل في البرنامج؟","How do I enroll in a program?"]],
 health:[["كيف أحجز موعدًا؟","How do I book an appointment?"],["ما المستندات المطلوبة للزيارة؟","What documents should I bring to my visit?"]],
 property:[["ما العقارات المتاحة؟","Which properties are available?"],["كيف أحجز موعد معاينة؟","How can I arrange a viewing?"]],
 travel:[["ما خيارات الحجز المتاحة؟","What booking options are available?"],["ما سياسة تعديل الحجز؟","What is your booking change policy?"]],
 beauty:[["ما الخدمات المتاحة؟","Which treatments are available?"],["كيف أحجز موعد الخدمة؟","How can I book a treatment?"]],
 automotive:[["ما خدمات السيارات المتاحة؟","Which vehicle services are available?"],["كيف أحجز موعدًا أو أطلب عرض سعر؟","How do I book or request a quote?"]],
 home:[["ما الخدمات المنزلية المتاحة؟","Which home services are available?"],["كيف أحدد موعد زيارة للمنزل؟","How do I schedule a home visit?"]],
 professional:[["ما الخدمات المهنية التي تقدمونها؟","Which professional services do you offer?"],["كيف أطلب استشارة أو عرض سعر؟","How do I request a consultation or quote?"]],
 events:[["ما خدمات تنظيم الفعاليات المتاحة؟","Which event services are available?"],["كيف أستفسر عن توفر موعد فعاليتي؟","How can I check availability for my event date?"]],
 fitness:[["ما الحصص أو برامج التدريب المتاحة؟","Which classes or training programs are available?"],["كيف أحجز حصة أو أستفسر عن الاشتراك؟","How do I book a class or ask about membership?"]],
 logistics:[["ما مناطق التوصيل أو الشحن المتاحة؟","Which delivery or shipping areas do you cover?"],["كيف أطلب عرض سعر للشحنة؟","How do I request a shipping quote?"]],
};
export function trialSuggestions(type:string,locale:"ar"|"en"):string[]{
 const group=businessTypes.find(item=>item.id===(type==="store"?"retail":type))?.group??"other";
 const specific=questions[group]??[["ما الخدمات المتاحة؟","What services are available?"],["كيف أطلب الخدمة؟","How do I request the service?"]];
 return [["ما مواعيد العمل؟","What are the working hours?"],...specific].slice(0,3).map(pair=>pair[locale==="ar"?0:1]);
}
export function trialFailureText(code:AnswerFailure["code"],ar:boolean):string{
 const pair:Record<AnswerFailure["code"],[string,string]>={
 NEEDS_SETUP:["الاختبار غير متاح بعد.","Trial is not available yet."],
 NO_KNOWLEDGE:["أضف معرفة معتمدة أولًا.","Add approved knowledge first."],
 APPROVAL_INCOMPLETE:["اعتمد أحدث نسخ المعرفة.","Approve the latest knowledge versions."],
 APPROVAL_FOUNDATION_UNAVAILABLE:["تعذّر التحقق من اعتماد المعرفة.","Knowledge approval could not be verified."],
 CONTEXT_OVERFLOW:["المعرفة تتجاوز حد السياق.","Knowledge exceeds the context limit."],
 INVALID_INPUT:["اختصر السؤال ضمن الحد المسموح.","Shorten the question to the allowed limit."],
 UNAUTHENTICATED:["انتهت الجلسة. سجّل الدخول مجددًا.","Session expired. Sign in again."],
 UNVERIFIED:["تحقّق من الحساب أولًا.","Verify the account first."],
 FORBIDDEN:["لا صلاحية لهذا الاختبار.","Not authorized for this trial."],
 UNAVAILABLE:["تعذّر الحصول على رد. تحقّق قبل إعادة المحاولة.","No answer yet. Check status before retrying."],
 };return (pair[code]??pair.UNAVAILABLE)[ar?0:1];
}
const CHAR_WARN_AT=Math.floor(ANSWER_MAX_QUESTION_CHARS*0.8);

export function PaidAssistantTrial(p:PaidAssistantTrialProps){
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,scoped=!!p.boundaryFingerprint&&same(p.scope,p.state.scope);
 if(!scoped||(!p.snapshot&&p.state.phase!=="loading"&&p.state.phase!=="unavailable")||(p.snapshot&&(!same(p.scope,p.snapshot.scope)||!Number.isSafeInteger(p.snapshot.version)||p.snapshot.version<1||!p.snapshot.knowledgeRevision||p.state.version!==p.snapshot.version)))
 return <section className={styles.view} dir={ar?"rtl":"ltr"}><p role="status">{t("تجربة هذا الفرع غير متاحة. أعد تحميل البيانات.","This branch trial is unavailable. Reload the data.")}</p></section>;
 const presentation:TrialSnapshot=p.snapshot??{scope:p.scope,version:0,knowledgeRevision:"",branchLabel:"—",businessType:"",canAsk:null,messages:[]};
 return <TrialForm key={JSON.stringify([p.scope,p.boundaryFingerprint])} {...p} snapshot={presentation}/>;
}

function TrialForm(p:PaidAssistantTrialProps & {snapshot:TrialSnapshot}){
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,id=useId();
 const [submitted,setSubmitted]=useState<string|null>(null);
 const [draft,setDraft]=useState(""),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false);
 const [sourcesOpen,setSourcesOpen]=useState<Record<string,boolean>>({});
 const mounted=useRef(false),reserved=useRef(false);
 const logRef=useRef<HTMLDivElement|null>(null);
 const endRef=useRef<HTMLDivElement|null>(null);
 const stickToBottom=useRef(true);
 const inputRef=useRef<HTMLTextAreaElement|null>(null);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useLayoutEffect(()=>{
  const node=inputRef.current;if(!node)return;
  node.style.height="auto";
  node.style.height=`${Math.min(Math.max(node.scrollHeight,40),128)}px`;
 },[draft]);
  useEffect(()=>{
  if(!stickToBottom.current||!endRef.current)return;
  const reduce=typeof window!=="undefined"&&typeof window.matchMedia==="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try{endRef.current.scrollIntoView({block:"nearest",behavior:reduce?"auto":"smooth"});}catch{/* jsdom may lack scrollIntoView */}
 },[p.snapshot.messages,submitted,pending,p.state.phase]);

 const blocked=pending||uncertain||!!p.snapshot.pendingOperation||p.state.phase!=="ready"||p.snapshot.canAsk!==true||!p.onAsk;
 const canRetry=!pending&&!uncertain&&p.state.phase==="error"&&p.state.failure?.retrySafe===true&&p.state.canRetry===true&&!!p.state.requestId?.trim()&&p.state.failure.requestId===p.state.requestId&&!!p.onRetry;
 const context:TrialContext={...p.scope,expectedVersion:p.snapshot.version,knowledgeRevision:p.snapshot.knowledgeRevision};
 const persona=p.persona==="level_1"||p.persona==="level_2"||p.persona==="level_3"?p.persona:null;
 const personaName=persona?PERSONA_NAMES[persona][ar?"ar":"en"]:t("المساعد","Assistant");
 const allowance=p.snapshot.trialAllowance;
 const messages=p.snapshot.messages.filter(m=>same(p.scope,m.scope)&&m.version===p.snapshot.version&&m.knowledgeRevision===p.snapshot.knowledgeRevision);
 const waiting=pending||p.state.phase==="pending";
 const showOptimistic=!!submitted&&!messages.some(message=>message.question===submitted);
 const suggestions=trialSuggestions(p.snapshot.businessType,p.locale);
 const nearLimit=draft.length>=CHAR_WARN_AT;

 async function dispatch(run:()=>void|Promise<void>){
  if(reserved.current||!p.isCurrent())return;reserved.current=true;setPending(true);
  try{await run();}catch{if(mounted.current&&p.isCurrent())setUncertain(true);}
  finally{reserved.current=false;if(mounted.current&&p.isCurrent())setPending(false);}
 }
 function ask(question:string){
  const trimmed=question.trim();
  if(blocked||!trimmed||trimmed.length>ANSWER_MAX_QUESTION_CHARS)return;
  stickToBottom.current=true;
  setSubmitted(trimmed);
  setDraft("");
  void dispatch(()=>p.onAsk?.({...context,question:trimmed,operationId:crypto.randomUUID()}));
 }
 function onComposerKey(event:KeyboardEvent<HTMLTextAreaElement>){
  if(event.key!=="Enter"||event.shiftKey||event.nativeEvent.isComposing)return;
  event.preventDefault();
  ask(draft);
 }
 function onLogScroll(){
  const node=logRef.current;if(!node)return;
  const remaining=node.scrollHeight-node.scrollTop-node.clientHeight;
  stickToBottom.current=remaining<72;
 }
 function onSubmit(event:FormEvent){
  event.preventDefault();
  ask(draft);
 }

 return <section className={styles.view} data-assistant-chat="" dir={ar?"rtl":"ltr"} aria-labelledby={id} aria-busy={waiting}>
  {p.state.phase==="loading"&&!p.snapshot.messages.length&&<p role="status" className={styles.statusLine}>{t("جارٍ تحميل تجربة المساعد.","Loading the assistant trial.")}</p>}
  {p.state.phase==="unavailable"&&<p role="status" className={styles.alert}>{t("تعذّر التحقق من البيانات.","Data could not be verified.")}{p.onRefresh&&<> <button type="button" className={styles.link} onClick={()=>{if(p.isCurrent())void p.onRefresh?.();}}>{t("إعادة المحاولة","Retry")}</button></>}</p>}

  <header className={styles.chatHeader}>
   <div className={styles.avatar} aria-hidden="true">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {persona?<img src={PERSONA_POSTERS[persona]} alt="" width={48} height={48} decoding="async"/>:<span>{personaName.slice(0,1)}</span>}
   </div>
   <div className={styles.headerCopy}>
    <h2 id={id}>{personaName}</h2>
    <p>{t("جرّب مساعدك","Try your assistant")}</p>
   </div>
   {allowance&&Number.isFinite(allowance.used)&&Number.isFinite(allowance.limit)&&allowance.limit>0&&(
    <p className={styles.quota} aria-label={t("حصة التجربة","Trial allowance")}><bdi dir="ltr">{allowance.used}/{allowance.limit}</bdi></p>
   )}
  </header>
  <p className={styles.note}>{t("اختبار داخلي فقط — لا يُرسل للعملاء ولا يعني جاهزية التشغيل.","Internal trial only — not sent to customers and not launch-ready.")}</p>

  {!messages.length&&!showOptimistic&&!waiting&&!blocked&&(
   <div className={styles.suggestions} aria-label={t("أسئلة مقترحة","Suggested questions")}>
    {suggestions.map(question=><button key={question} type="button" className={styles.chip} disabled={blocked} onClick={()=>{if(p.isCurrent())ask(question);}}>{question}</button>)}
   </div>
  )}

  <div ref={logRef} className={styles.transcript} role="log" aria-live="polite" aria-relevant="additions text" aria-label={t("محادثة الاختبار","Trial conversation")} onScroll={onLogScroll}>
   {!submitted&&!messages.length&&!waiting&&<p className={styles.empty}>{t("اكتب سؤالًا أو اختر اقتراحًا.","Write a question or choose a suggestion.")}</p>}
   {messages.map(m=>{
    const ok=m.result.ok;
    const citations=ok?m.result.citations:[];
    const open=!!sourcesOpen[m.id];
    return <div key={m.id} className={styles.turn}>
     {m.origin==="synthetic"&&<p className={styles.synthetic}>{t("مثال واجهة فقط — ليس رد ذكاء اصطناعي.","UI example only — not an AI reply.")}</p>}
     <div className={styles.bubbleUser}><p dir="auto">{m.question}</p></div>
     <div className={styles.bubbleAssistant} data-failed={ok?undefined:""}>
      {ok?<p dir="auto">{m.result.text}</p>:<p>{trialFailureText(m.result.code,ar)}</p>}
      {ok&&citations.length>0&&(
       <div className={styles.sources}>
        <button type="button" className={styles.link} aria-expanded={open} onClick={()=>{if(p.isCurrent())setSourcesOpen(current=>({...current,[m.id]:!open}));}}>
         {open?t("إخفاء المصادر","Hide sources"):t(`المصادر (${citations.length})`,`Sources (${citations.length})`)}
        </button>
        {open&&<ul>{citations.map(c=><li key={`${c.sourceId}:${c.contentVersion}`}><bdi>{c.title}</bdi></li>)}</ul>}
       </div>
      )}
     </div>
    </div>;
   })}
   {showOptimistic&&(
    <div className={styles.turn}>
     <div className={styles.bubbleUser}><p dir="auto">{submitted}</p></div>
     {waiting&&<div className={styles.typing} role="status"><span/><span/><span/><span className={styles.srOnly}>{t("جارٍ توليد الرد…","Generating a reply…")}</span></div>}
     {!waiting&&<p role="status" className={styles.statusLine}>{t("لم تتأكد نتيجة هذا السؤال بعد.","This question has no confirmed result yet.")}</p>}
    </div>
   )}
   {waiting&&!showOptimistic&&<div className={styles.typing} role="status"><span/><span/><span/><span className={styles.srOnly}>{t("جارٍ توليد الرد…","Generating a reply…")}</span></div>}
   <div ref={endRef}/>
  </div>

  {(uncertain||p.state.phase==="unknown")&&<p role="alert" className={styles.alert}>{t("النتيجة غير معروفة. تحقّق قبل إرسال سؤال جديد.","Outcome unknown. Check status before sending another question.")}</p>}
  {p.state.phase==="error"&&<div className={styles.alert} role="alert"><p>{trialFailureText(p.state.failure?.code??"UNAVAILABLE",ar)}</p><button type="button" className={styles.secondary} disabled={!canRetry} onClick={()=>{if(canRetry)void dispatch(()=>p.onRetry?.({...context,requestId:p.state.requestId!}));}}>{t("إعادة محاولة آمنة","Retry safely")}</button></div>}
  {(p.state.phase==="unknown"||p.state.phase==="error")&&p.onRefresh&&<button type="button" className={styles.secondary} disabled={pending} onClick={()=>{if(!pending&&p.isCurrent())void dispatch(()=>p.onRefresh?.());}}>{t("التحقق من حالة الطلب","Check request status")}</button>}
  {p.snapshot.handoffPreview&&<p role="status" className={styles.note}>{t("معاينة تصعيد فقط — بلا تحويل حقيقي أو خصم من الحصة.","Escalation preview only — no real handoff or quota use.")}</p>}
  {p.snapshot.recoveryNotice==="context_changed"&&<p role="status" className={styles.note}>{t("تغيّرت الإعدادات أثناء الطلب السابق دون خصم من الحصة.","Settings changed during the previous request without using quota.")}</p>}
  {p.snapshot.pendingOperation&&<div className={styles.pending} role="status">
   <p>{t("طلب سابق لم يُحسم بعد.","A previous request is still unresolved.")}</p>
   <div className={styles.pendingActions}>
    {p.snapshot.pendingOperation.recoverable&&p.onRecover&&<button type="button" className={styles.secondary} disabled={pending} onClick={()=>{if(!pending&&p.isCurrent())void dispatch(()=>p.onRecover?.(p.snapshot.pendingOperation!.id));}}>{t("استعادة الرد","Recover reply")}</button>}
    {p.onRefresh&&<button type="button" className={styles.secondary} disabled={pending} onClick={()=>{if(!pending&&p.isCurrent())void dispatch(()=>p.onRefresh?.());}}>{t("تحديث الحالة","Refresh status")}</button>}
   </div>
  </div>}

  <form className={styles.composer} onSubmit={onSubmit}>
   <label className={styles.srOnly} htmlFor={`${id}-question`}>{t("اكتب رسالتك","Write your message")}</label>
   <textarea
    ref={inputRef}
    id={`${id}-question`}
    dir="auto"
    rows={1}
    maxLength={ANSWER_MAX_QUESTION_CHARS}
    value={draft}
    disabled={pending||p.state.phase==="pending"}
    placeholder={t("اكتب سؤالك…","Type your question…")}
    onChange={e=>{if(p.isCurrent())setDraft(e.target.value);}}
    onKeyDown={onComposerKey}
   />
   <div className={styles.composerBar}>
    {nearLimit?<small className={styles.counter}><bdi dir="ltr">{draft.length}/{ANSWER_MAX_QUESTION_CHARS}</bdi></small>:<span/>}
    <button type="submit" className={styles.send} disabled={blocked||!draft.trim()||draft.trim().length>ANSWER_MAX_QUESTION_CHARS}>{t("إرسال","Send")}</button>
   </div>
  </form>
  {!p.onAsk&&<p className={styles.note}>{t("الاختبار غير مربوط بمحرك الإجابات بعد.","This trial is not connected to the answer engine yet.")}</p>}
 </section>;
}

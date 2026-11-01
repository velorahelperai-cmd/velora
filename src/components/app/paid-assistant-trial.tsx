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
export type TrialSnapshot={scope:TrialScope;version:number;knowledgeRevision:string;branchLabel:string;businessType:string;canAsk:boolean|null;handoffPreview?:"human_request"|"sensitive";recoveryNotice?:"context_changed";trialAllowance?:{limit:number;used:number};pendingOperation?:{id:string;status:string;recoverable:boolean;blocksNewRequests?:boolean}|null;messages:TrialMessage[]};
export type PaidAssistantTrialProps={
 onRecover?:(operationId:string)=>void|Promise<void>;
 /** Compatibility callback only; uncertain holds cannot be released without evidence. */
 onRelease?:(operationId:string)=>void|Promise<void>;
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
export function trialFailureText(code:AnswerFailure["code"],ar:boolean,detail?:string):string{
 if(detail==="TRIAL_BUDGET_EXCEEDED")return ar?"توقف الطلب لأن الحد المسموح لميزانية التجربة لا يكفي. لم يبدأ توليد الإجابة. يلزم التحقق من الميزانية قبل المحاولة مجددًا.":"The request was blocked by the trial budget limit. Answer generation did not start. The budget must be reviewed before another attempt.";
 if(detail==="TRIAL_LIMIT_REACHED")return ar?"اكتملت حصة التجربة المجانية (10/10) لهذا الفرع.":"All 10 free trial replies have been used for this branch.";
 if(detail==="CONTEXT_CHANGED")return ar?"تم تحديث بيانات الفرع. حدّث الصفحة ثم أعد المحاولة.":"Branch context was updated. Refresh and try again.";
 if(detail==="RATE_LIMITED"||detail==="TOO_MANY_REQUESTS")return ar?"تم إرسال طلبات متتالية بسرعة. انتظر قليلًا ثم أعد المحاولة.":"Too many rapid requests. Wait a moment and try again.";
 const pair:Record<AnswerFailure["code"],[string,string]>={
 NEEDS_SETUP:[
  "المساعد غير متاح حاليًا، حاول لاحقًا.",
  "The assistant is currently unavailable, please try again later."
 ],
 NO_KNOWLEDGE:["أضف معرفة معتمدة للفرع أولًا لتجربة الردود.","Add approved branch knowledge first to try replies."],
 APPROVAL_INCOMPLETE:["اعتمد أحدث نسخ المعرفة أولًا.","Approve the latest knowledge versions first."],
 APPROVAL_FOUNDATION_UNAVAILABLE:["تعذّر التحقق من اعتماد المعرفة حاليًا.","Knowledge approval could not be verified right now."],
 CONTEXT_OVERFLOW:["حجم المعرفة يتجاوز الحد المسموح للسياق.","Knowledge size exceeds the allowed context limit."],
 INVALID_INPUT:["اختصر السؤال ليكون ضمن الحد المسموح.","Shorten the question to stay within the allowed limit."],
 UNAUTHENTICATED:["انتهت الجلسة. سجّل الدخول مجددًا.","Session expired. Please sign in again."],
 UNVERIFIED:["تحقّق من الحساب أولًا.","Verify your account first."],
 FORBIDDEN:["لا توجد صلاحية لتجربة هذا الفرع.","You do not have permission to test this branch."],
 UNAVAILABLE:["تعذّر الحصول على رد الآن. تحقّق من حالة الطلب قبل إرسال سؤال جديد.","Could not get a reply right now. Check request status before sending another question."],
 };return (pair[code]??pair.UNAVAILABLE)[ar?0:1];
}
const CHAR_WARN_AT=Math.floor(ANSWER_MAX_QUESTION_CHARS*0.8);

export function PaidAssistantTrial(p:PaidAssistantTrialProps){
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,scoped=!!p.boundaryFingerprint&&same(p.scope,p.state.scope);
 if(!scoped||(!p.snapshot&&p.state.phase!=="loading"&&p.state.phase!=="unavailable")||(p.snapshot&&(!same(p.scope,p.snapshot.scope)||!Number.isSafeInteger(p.snapshot.version)||p.snapshot.version<1||!p.snapshot.knowledgeRevision||p.state.version!==p.snapshot.version)))
 return <section className={styles.view} dir={ar?"rtl":"ltr"}><div className={styles.card}><p role="status" className={styles.alert}>{t("تجربة هذا الفرع غير متاحة. أعد تحميل البيانات.","This branch trial is unavailable. Reload the data.")}</p></div></section>;
 const presentation:TrialSnapshot=p.snapshot??{scope:p.scope,version:0,knowledgeRevision:"",branchLabel:"—",businessType:"",canAsk:null,messages:[]};
 return <TrialForm key={JSON.stringify([p.scope,p.boundaryFingerprint])} {...p} snapshot={presentation}/>;
}

function TrialForm(p:PaidAssistantTrialProps & {snapshot:TrialSnapshot}){
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,id=useId();
 const [submitted,setSubmitted]=useState<string|null>(null);
 const [draft,setDraft]=useState(""),[pending,setPending]=useState(false),[uncertainSnapshot,setUncertainSnapshot]=useState<TrialSnapshot|null>(null);
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
  node.style.height=`${Math.min(Math.max(node.scrollHeight,42),128)}px`;
 });
 useEffect(()=>{
  if(!stickToBottom.current||!endRef.current)return;
  const reduce=typeof window!=="undefined"&&typeof window.matchMedia==="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try{endRef.current.scrollIntoView({block:"nearest",behavior:reduce?"auto":"smooth"});}catch{/* jsdom may lack scrollIntoView */}
 },[p.snapshot.messages,submitted,pending,p.state.phase]);

 const limitReached=!!p.snapshot.trialAllowance&&p.snapshot.trialAllowance.limit>0&&p.snapshot.trialAllowance.used>=p.snapshot.trialAllowance.limit;
 // Error/unknown never reopen free Send. Retry is a separate control gated on
 // explicit server retrySafe + matching requestId — button label is not authority.
 const canDispatchPhase=p.state.phase==="ready";
 const oldUnknownAllowsNew=p.snapshot.pendingOperation?.status==="uncertain"&&!p.snapshot.pendingOperation.recoverable&&p.snapshot.pendingOperation.blocksNewRequests===false;
 const uncertain=uncertainSnapshot!==null&&!(uncertainSnapshot!==p.snapshot&&oldUnknownAllowsNew&&p.snapshot.canAsk===true&&canDispatchPhase);
 const blocked=pending||uncertain||(!!p.snapshot.pendingOperation&&!oldUnknownAllowsNew)||!canDispatchPhase||p.snapshot.canAsk!==true||limitReached||!p.onAsk;
 const canRetry=!pending&&!uncertain&&p.state.phase==="error"&&p.state.failure?.retrySafe===true&&p.state.canRetry===true&&!!p.state.requestId?.trim()&&p.state.failure.requestId===p.state.requestId&&p.snapshot.canAsk===true&&!p.snapshot.pendingOperation&&!!p.onRetry;
 const context:TrialContext={...p.scope,expectedVersion:p.snapshot.version,knowledgeRevision:p.snapshot.knowledgeRevision};
 const persona=p.persona==="level_1"||p.persona==="level_2"||p.persona==="level_3"?p.persona:null;
 const personaName=persona?PERSONA_NAMES[persona][ar?"ar":"en"]:t("المساعد","Assistant");
 const allowance=p.snapshot.trialAllowance;
 const messages=p.snapshot.messages.filter(m=>same(p.scope,m.scope)&&m.version===p.snapshot.version&&m.knowledgeRevision===p.snapshot.knowledgeRevision);
 const waiting=pending||p.state.phase==="pending";
 const showOptimistic=!!submitted&&!messages.some(message=>message.question===submitted);
 const failedRetained=(p.state.phase==="error"||p.state.phase==="unknown"||uncertain)&&showOptimistic?submitted:null;
 const effectiveDraft=draft||(failedRetained??"");
 const suggestions=trialSuggestions(p.snapshot.businessType,p.locale);
 const nearLimit=effectiveDraft.length>=CHAR_WARN_AT;

 async function dispatch(run:()=>void|Promise<void>){
  if(reserved.current||!p.isCurrent())return;reserved.current=true;setPending(true);
  try{await run();}catch{if(mounted.current&&p.isCurrent())setUncertainSnapshot(p.snapshot);}
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
  ask(effectiveDraft);
 }
 function onLogScroll(){
  const node=logRef.current;if(!node)return;
  const remaining=node.scrollHeight-node.scrollTop-node.clientHeight;
  stickToBottom.current=remaining<72;
 }
 function onSubmit(event:FormEvent){
  event.preventDefault();
  ask(effectiveDraft);
 }

 return <section className={styles.view} data-assistant-chat="" dir={ar?"rtl":"ltr"} aria-labelledby={id} aria-busy={waiting || p.state.phase==="loading"}>
  <div className={styles.card}>
   {p.state.phase==="loading"&&<p role="status" className={styles.srOnly}>{t("يتم التحقق من حالة المساعد.","Checking assistant status.")}</p>}
   {p.state.phase==="unavailable"&&<p role="status" className={styles.alert}>{t("تعذّر التحقق من البيانات.","Data could not be verified.")}{p.onRefresh&&<> <button type="button" className={styles.link} onClick={()=>{if(p.isCurrent())void p.onRefresh?.();}}>{t("إعادة المحاولة","Retry")}</button></>}</p>}

   <header className={styles.chatHeader}>
    <div className={styles.identity}>
     <div className={styles.avatar} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {persona?<img src={PERSONA_POSTERS[persona]} alt="" width={44} height={44} decoding="async"/>:<span>{personaName.slice(0,1)}</span>}
     </div>
     <div className={styles.headerCopy}>
      <div className={styles.titleRow}>
       <h2 id={id}>{personaName}</h2>
       {p.snapshot.branchLabel&&p.snapshot.branchLabel!=="—"&&<span className={styles.branchBadge}>{p.snapshot.branchLabel}</span>}
      </div>
      <p>{t("جرّب مساعدك قبل التشغيل","Try your assistant before launch")}</p>
     </div>
    </div>
    {allowance&&Number.isFinite(allowance.used)&&Number.isFinite(allowance.limit)&&allowance.limit>0&&(
     <div className={styles.quotaWrap} aria-label={t("الردود التجريبية المتاحة","Available trial replies")}>
      <span className={styles.quotaLabel}>{t("الردود المجانية","Free replies")}</span>
      <p className={styles.quota} data-full={limitReached? "":undefined}><bdi dir="ltr">{allowance.used}/{allowance.limit}</bdi></p>
     </div>
    )}
   </header>

   <p className={styles.note}>{t("تعتمد الإجابات هنا على معرفة الفرع وساعات العمل المعتمدة، وتبقى داخل حسابك دون إرسال أي رسائل لعملائك.","Replies here are grounded in your branch knowledge and working hours, and stay inside your account without messaging customers.")}</p>

   {!waiting&&!limitReached&&(
    <div className={styles.suggestionsBar}>
     <span className={styles.suggestionsLabel}>{t("جرّب سؤالًا سريعًا:","Try a quick question:")}</span>
     <div className={styles.suggestions} aria-label={t("أسئلة مقترحة","Suggested questions")}>
      {suggestions.map(question=><button key={question} type="button" className={styles.chip} disabled={blocked} onClick={()=>{if(p.isCurrent())ask(question);}}>{question}</button>)}
     </div>
    </div>
   )}

   <div ref={logRef} className={styles.transcript} data-empty={!submitted&&!messages.length&&!waiting?"true":undefined} role="log" aria-live="polite" aria-relevant="additions text" aria-label={t("محادثة التجربة","Trial conversation")} onScroll={onLogScroll}>
    {!submitted&&!messages.length&&!waiting&&(
     <div className={styles.emptyState}>
      <p className={styles.empty}>{t("اكتب سؤالًا أو اختر اقتراحًا لتجربة رد المساعد.","Write a question or choose a suggestion to test your assistant's reply.")}</p>
     </div>
    )}
    {messages.map(m=>{
     const ok=m.result.ok;
     const citations=ok?m.result.citations:[];
     const open=!!sourcesOpen[m.id];
     return <div key={m.id} className={styles.turn}>
      {m.origin==="synthetic"&&<p className={styles.synthetic}>{t("مثال واجهة فقط — ليس رد ذكاء اصطناعي.","UI example only — not an AI reply.")}</p>}
      <div className={styles.bubbleUser}><p dir="auto">{m.question}</p></div>
      <div className={styles.bubbleAssistant} data-failed={ok?undefined:""}>
       <div className={styles.assistantMeta}>
        <span>{personaName}</span>
       </div>
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
      {!waiting&&p.state.phase==="error"&&<p role="status" className={styles.statusLine}>{t("تعذّر إتمام الرد على هذا السؤال. تم الاحتفاظ بسؤالك لإعادة المحاولة.","Could not complete the reply. Your question is retained so you can retry.")}</p>}
      {!waiting&&p.state.phase!=="error"&&<p role="status" className={styles.statusLine}>{t("لم تتأكد نتيجة هذا السؤال بعد.","This question has no confirmed result yet.")}</p>}
     </div>
    )}
    {waiting&&!showOptimistic&&<div className={styles.typing} role="status"><span/><span/><span/><span className={styles.srOnly}>{t("جارٍ توليد الرد…","Generating a reply…")}</span></div>}
    <div ref={endRef}/>
   </div>

   {limitReached&&(
    <p role="status" className={styles.limitBanner}>
     {t("استخدمت كامل الردود المجانية للتجربة (10/10) لهذا الفرع دون أي خصم من باقتك المدفوعة.","You have used all 10 free trial replies for this branch without any deduction from your paid plan.")}
    </p>
   )}
   {(uncertain||p.state.phase==="unknown")&&<p role="alert" className={styles.alert}>{t("النتيجة غير معروفة. تحقّق قبل إرسال سؤال جديد.","Outcome unknown. Check status before sending another question.")}</p>}
   {p.state.phase==="error"&&(
    <div className={styles.alert} role="alert">
     <p>{trialFailureText(p.state.failure?.code??"UNAVAILABLE",ar,p.state.failure?.message)}</p>
     <div className={styles.alertActions}>
      <button type="button" className={styles.secondary} disabled={!canRetry} onClick={()=>{if(canRetry)void dispatch(()=>p.onRetry?.({...context,requestId:p.state.requestId!}));}}>{t("إعادة محاولة آمنة","Retry safely")}</button>
      {p.onRefresh&&<button type="button" className={styles.secondary} disabled={pending} onClick={()=>{if(!pending&&p.isCurrent())void dispatch(()=>p.onRefresh?.());}}>{t("التحقق من حالة الطلب","Check request status")}</button>}
     </div>
    </div>
   )}
   {p.state.phase==="unknown"&&p.onRefresh&&(
    <div className={styles.alertActions}>
     <button type="button" className={styles.secondary} disabled={pending} onClick={()=>{if(!pending&&p.isCurrent())void dispatch(()=>p.onRefresh?.());}}>{t("التحقق من حالة الطلب","Check request status")}</button>
    </div>
   )}
   {p.snapshot.handoffPreview&&<p role="status" className={styles.previewBanner}>{t("معاينة تصعيد فقط — بلا تحويل حقيقي أو خصم من الحصة.","Escalation preview only — no real handoff or quota use.")}</p>}
   {p.snapshot.recoveryNotice==="context_changed"&&<p role="status" className={styles.note}>{t("تغيّرت الإعدادات أثناء الطلب السابق دون خصم من الحصة.","Settings changed during the previous request without using quota.")}</p>}
   {p.snapshot.pendingOperation&&<div className={styles.pending} role="status">
    <p>{t("طلب سابق لم يُحسم بعد.","A previous request is still unresolved.")}</p>
    <div className={styles.pendingActions}>
     {p.snapshot.pendingOperation.recoverable&&p.onRecover&&<button type="button" className={styles.secondary} disabled={pending} onClick={()=>{if(!pending&&p.isCurrent())void dispatch(()=>p.onRecover?.(p.snapshot.pendingOperation!.id));}}>{t("استعادة الرد","Recover reply")}</button>}
     {!p.snapshot.pendingOperation.recoverable&&p.snapshot.pendingOperation.status==="uncertain"&&<p>{oldUnknownAllowsNew?t("الطلب السابق قيد المراجعة. يمكنك إرسال سؤال جديد عند إتاحة الإرسال.","The previous request remains under review. You can ask a new question when Send is available."):t("بانتظار مراجعة نتيجة الطلب قبل إرسال سؤال جديد.","The request outcome needs review before another question can be sent.")}</p>}
     {p.onRefresh&&<button type="button" className={styles.secondary} disabled={pending} onClick={()=>{if(!pending&&p.isCurrent())void dispatch(()=>p.onRefresh?.());}}>{t("تحديث الحالة","Refresh status")}</button>}
    </div>
   </div>}

   <form className={styles.composer} onSubmit={onSubmit}>
    <label className={styles.srOnly} htmlFor={`${id}-question`}>{t("اكتب رسالتك","Write your message")}</label>
    <div className={styles.composerRow}>
     <textarea
      ref={inputRef}
      id={`${id}-question`}
      dir="auto"
      rows={1}
      maxLength={ANSWER_MAX_QUESTION_CHARS}
      value={effectiveDraft}
      disabled={pending||p.state.phase==="pending"||limitReached}
      placeholder={limitReached?t("اكتملت حصة التجربة المجانية (10/10)","Free trial limit reached (10/10)"):t("اكتب سؤالك هنا… (Enter للإرسال، Shift+Enter لسطر جديد)","Type your question… (Enter to send, Shift+Enter for new line)")}
      onChange={e=>{if(p.isCurrent())setDraft(e.target.value);}}
      onKeyDown={onComposerKey}
     />
     <button type="submit" className={styles.send} disabled={blocked||!effectiveDraft.trim()||effectiveDraft.trim().length>ANSWER_MAX_QUESTION_CHARS}>
      <span>{waiting?t("جارٍ الرد…","Replying…"):t("إرسال","Send")}</span>
     </button>
    </div>
    {nearLimit&&(
     <div className={styles.composerMeta}>
      <small className={styles.counter}><bdi dir="ltr">{effectiveDraft.length}/{ANSWER_MAX_QUESTION_CHARS}</bdi></small>
     </div>
    )}
   </form>
   {!p.onAsk&&<p className={styles.note}>{t("الاختبار غير مربوط بمحرك الإجابات بعد.","This trial is not connected to the answer engine yet.")}</p>}
  </div>
 </section>;
}

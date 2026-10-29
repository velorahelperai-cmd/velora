"use client";
import {useId,useLayoutEffect,useRef,useState} from "react";
import {ANSWER_MAX_QUESTION_CHARS} from "@/lib/answers/constants";
import type {AnswerFailure,AnswerResult} from "@/lib/answers/types";
import {businessTypes,businessTypeLabel} from "@/lib/business-types";
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
 const specific=questions[group]??[["ما الخدمات التي تقدمونها؟","What services do you offer?"],["كيف أطلب الخدمة أو عرض سعر؟","How do I request a service or quote?"]];
 return [["ما أوقات عمل هذا الفرع؟","What are this branch's working hours?"],...specific].map(pair=>pair[locale==="ar"?0:1]);
}
export function trialFailureText(code:AnswerFailure["code"],ar:boolean):string{
 const pair:Record<AnswerFailure["code"],[string,string]>={
 NEEDS_SETUP:["خدمة الإجابات ليست متاحة للاختبار بعد.","Answering is not available for testing yet."],
 NO_KNOWLEDGE:["أضف معرفة معتمدة قبل الاختبار.","Add approved knowledge before testing."],
 APPROVAL_INCOMPLETE:["تحتاج مصادر المعرفة إلى اعتماد أحدث نسخها.","The latest knowledge versions need approval."],
 APPROVAL_FOUNDATION_UNAVAILABLE:["تعذّر التحقق من اعتماد المعرفة.","Knowledge approval could not be verified."],
 CONTEXT_OVERFLOW:["تتجاوز المعرفة حد السياق المتاح؛ راجع مصادرها.","Knowledge exceeds the available context limit; review its sources."],
 INVALID_INPUT:["اكتب سؤالًا ضمن الحد المسموح.","Enter a question within the allowed limit."],
 UNAUTHENTICATED:["انتهت الجلسة؛ سجّل الدخول ثم أعد تحميل الفرع.","Your session expired; sign in and reload the branch."],
 UNVERIFIED:["تحقّق من الحساب قبل الاختبار.","Verify the account before testing."],
 FORBIDDEN:["لا يملك هذا الحساب صلاحية إجراء الاختبار.","This account is not authorized to run this test."],
 UNAVAILABLE:["تعذّر الحصول على إجابة. راجع حالة الطلب قبل المحاولة مجددًا.","An answer could not be obtained. Check request status before trying again."],
 };return (pair[code]??pair.UNAVAILABLE)[ar?0:1];
}
export function PaidAssistantTrial(p:PaidAssistantTrialProps){
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,scoped=!!p.boundaryFingerprint&&same(p.scope,p.state.scope);
 if(!scoped||(!p.snapshot&&p.state.phase!=="loading"&&p.state.phase!=="unavailable")||(p.snapshot&&(!same(p.scope,p.snapshot.scope)||!Number.isSafeInteger(p.snapshot.version)||p.snapshot.version<1||!p.snapshot.knowledgeRevision||p.state.version!==p.snapshot.version)))
 return <section className={styles.view} dir={ar?"rtl":"ltr"}><p role="status">{t("تجربة هذا الفرع غير متاحة. أعد تحميل بيانات الحساب والفرع.","This branch's trial is unavailable. Reload the account and branch data.")}</p></section>;
 const presentation:TrialSnapshot=p.snapshot??{scope:p.scope,version:0,knowledgeRevision:"",branchLabel:"—",businessType:"",canAsk:null,messages:[]};
 return <TrialForm key={JSON.stringify([p.scope,p.boundaryFingerprint])} {...p} snapshot={presentation}/>;
}

function TrialForm(p:PaidAssistantTrialProps & {snapshot:TrialSnapshot}){
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,id=useId();
 const [submitted,setSubmitted]=useState<string|null>(null);
 const [draft,setDraft]=useState(""),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false);
 const mounted=useRef(false),reserved=useRef(false);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const blocked=pending||uncertain||!!p.snapshot.pendingOperation||p.state.phase!=="ready"||p.snapshot.canAsk!==true||!p.onAsk;
 const canRetry=!pending&&!uncertain&&p.state.phase==="error"&&p.state.failure?.retrySafe===true&&p.state.canRetry===true&&!!p.state.requestId?.trim()&&p.state.failure.requestId===p.state.requestId&&!!p.onRetry;
 const context:TrialContext={...p.scope,expectedVersion:p.snapshot.version,knowledgeRevision:p.snapshot.knowledgeRevision};
 async function dispatch(run:()=>void|Promise<void>){
  if(reserved.current||!p.isCurrent())return;reserved.current=true;setPending(true);
  try{await run();}catch{if(mounted.current&&p.isCurrent())setUncertain(true);}
  finally{reserved.current=false;if(mounted.current&&p.isCurrent())setPending(false);}
 }
 const messages=p.snapshot.messages.filter(m=>same(p.scope,m.scope)&&m.version===p.snapshot.version&&m.knowledgeRevision===p.snapshot.knowledgeRevision);
 return <section className={styles.view} dir={ar?"rtl":"ltr"} aria-labelledby={id} aria-busy={pending||p.state.phase==="pending"}>
  {p.state.phase==="loading"&&<p role="status">{t("جارٍ تحميل تجربة المساعد.","Loading the assistant trial.")}</p>}
  {p.state.phase==="unavailable"&&<p role="status">{t("تعذّر التحقق من البيانات. الحفظ غير مؤكد.","Data could not be verified. Saving is unconfirmed.")}</p>}
  {p.state.phase==="unavailable"&&p.onRefresh&&<button type="button" onClick={()=>{if(p.isCurrent())void p.onRefresh?.();}}>{t("إعادة المحاولة","Retry")}</button>}
  <header><h2 id={id}>{t("جرّب مساعدك","Try your assistant")}</h2><p>{t("الفرع: ","Branch: ")}<bdi>{p.snapshot.branchLabel}</bdi> · <bdi>{businessTypeLabel(p.snapshot.businessType,ar)}</bdi></p></header>
  <p className={styles.note}>{t("اختبار داخلي؛ لا تُرسل هذه الرسائل إلى العملاء. ظهور إجابة لا يثبت الجاهزية ولا يطلق الردود الحية.","Internal trial: these messages are not sent to customers. An answer does not prove readiness or launch live replies.")}</p>
  {p.snapshot.trialAllowance&&<p role="status"><bdi>{p.snapshot.trialAllowance.used} / {p.snapshot.trialAllowance.limit}</bdi> {t("ردود التجربة المجانية المستخدمة","free setup replies used")}</p>}
  <div className={styles.suggestions} aria-label={t("أسئلة مقترحة","Suggested questions")}>{trialSuggestions(p.snapshot.businessType,p.locale).map(question=><button key={question} type="button" disabled={blocked} onClick={()=>{if(p.isCurrent())setDraft(question);}}>{question}</button>)}</div>
  <div className={styles.transcript} role="log" aria-live="polite" aria-relevant="additions text" aria-label={t("محادثة الاختبار","Trial conversation")}>
   {submitted&&!messages.some(message=>message.question===submitted)&&<article><div className={styles.question}><small>{t("سؤالك","Your question")}</small><p dir="auto">{submitted}</p></div><p role="status">{pending||p.state.phase==="pending"?t("جارٍ انتظار نتيجة الطلب…","Waiting for the request result…"):t("لم تتأكد نتيجة هذا السؤال بعد.","This question has no confirmed result yet.")}</p></article>}
   {!submitted&&!messages.length&&<p className={styles.empty}>{t("اختر سؤالًا مقترحًا أو اكتب سؤالك لبدء الاختبار.","Choose a suggested question or write your own to start the trial.")}</p>}
   {messages.map(m=><article key={m.id}>
    {m.origin==="synthetic"&&<p className={styles.synthetic}>{t("مثال اصطناعي للواجهة — ليس نتيجة ذكاء اصطناعي أو دليل جاهزية.","Synthetic UI example — not an AI result or readiness evidence.")}</p>}
    <div className={styles.question}><small>{t("سؤالك","Your question")}</small><p dir="auto">{m.question}</p></div>
    <div className={styles.answer}><small>{t("نتيجة الاختبار","Trial result")}</small>
     {m.result.ok?<><p dir="auto">{m.result.text}</p><ul aria-label={t("المصادر","Sources")}>{m.result.citations.map(c=><li key={`${c.sourceId}:${c.contentVersion}`}><bdi>{c.title}</bdi> · {t("نسخة","version")} <bdi>{c.contentVersion}</bdi></li>)}</ul>{!m.result.citations.length&&<small>{t("لا توجد مصادر مرفقة بهذه النتيجة.","No sources are attached to this result.")}</small>}</>:<p>{trialFailureText(m.result.code,ar)}</p>}
    </div>
   </article>)}
   {(pending||p.state.phase==="pending")&&<p role="status">{t("جارٍ انتظار نتيجة الطلب…","Waiting for the request result…")}</p>}
  </div>
  {(uncertain||p.state.phase==="unknown")&&<p role="alert" className={styles.error}>{t("نتيجة الطلب غير معروفة. تحقّق من حالته قبل إرسال طلب جديد؛ لن نعيد المحاولة تلقائيًا.","The request outcome is unknown. Check its status before sending another request; it will not be retried automatically.")}</p>}
  {p.state.phase==="error"&&<div className={styles.error} role="alert"><p>{trialFailureText(p.state.failure?.code??"UNAVAILABLE",ar)}</p><button type="button" disabled={!canRetry} onClick={()=>{if(canRetry)void dispatch(()=>p.onRetry?.({...context,requestId:p.state.requestId!}));}}>{t("إعادة محاولة آمنة","Retry safely")}</button>{!canRetry&&<p>{t("إعادة المحاولة تنتظر إذنًا مؤكدًا من الخادم.","Retry is waiting for explicit server authorization.")}</p>}</div>}
  {(p.state.phase==="unknown"||p.state.phase==="error")&&p.onRefresh&&<button type="button" disabled={pending} onClick={()=>{if(!pending&&p.isCurrent())void dispatch(()=>p.onRefresh?.());}}>{t("التحقق من حالة الطلب","Check request status")}</button>}
  {p.snapshot.handoffPreview&&<p role="status">{t("معاينة التصعيد والمراجعة البشرية فقط: صُنّف الطلب وفق سياسة المساعد. لم تُحوّل محادثة حقيقية ولم يُرسل طلب AI أو يُخصم رد من التجربة.","Escalation and human-review preview only: the request matched the assistant policy. No real conversation was transferred, no AI request was sent, and no trial reply was used.")}</p>}
  {p.snapshot.recoveryNotice==="context_changed"&&<p role="status">{t("تغيّرت الإعدادات أثناء الطلب السابق. سُجّلت تكلفته دون احتسابه من ردود التجربة؛ يمكنك إرسال سؤال بالإعدادات الحالية.","Settings changed during the previous request. Its cost was recorded without using a trial reply; you can ask with the current settings.")}</p>}
  {p.snapshot.pendingOperation&&<div role="status"><p>{t("يوجد طلب سابق لم تُحسم نتيجته بعد. لن نرسل سؤالًا جديدًا أثناء التسوية.","A previous request is unresolved. New questions are blocked during reconciliation.")}</p>{p.snapshot.pendingOperation.recoverable&&p.onRecover&&<button type="button" disabled={pending} onClick={()=>{if(!pending&&p.isCurrent())void dispatch(()=>p.onRecover?.(p.snapshot.pendingOperation!.id));}}>{t("استعادة الرد المحفوظ","Recover saved answer")}</button>}{p.onRefresh&&<button type="button" disabled={pending} onClick={()=>{if(!pending&&p.isCurrent())void dispatch(()=>p.onRefresh?.());}}>{t("تحديث الحالة","Refresh status")}</button>}</div>}
  <form onSubmit={e=>{e.preventDefault();const question=draft.trim();if(!blocked&&question&&question.length<=ANSWER_MAX_QUESTION_CHARS){setSubmitted(question);void dispatch(()=>p.onAsk?.({...context,question,operationId:crypto.randomUUID()}));}}}>
   <label htmlFor={`${id}-question`}>{t("اكتب سؤالك","Write your question")}</label>
   <textarea id={`${id}-question`} dir="auto" rows={3} maxLength={ANSWER_MAX_QUESTION_CHARS} value={draft} disabled={pending||p.state.phase==="pending"} onChange={e=>{if(p.isCurrent())setDraft(e.target.value);}}/>
   <div className={styles.footer}><small><bdi dir="ltr">{draft.length} / {ANSWER_MAX_QUESTION_CHARS}</bdi></small><button type="submit" disabled={blocked||!draft.trim()||draft.trim().length>ANSWER_MAX_QUESTION_CHARS}>{t("إرسال السؤال","Send question")}</button></div>
  </form>
  {!p.onAsk&&<p className={styles.note}>{t("الاختبار غير مربوط بمحرك الإجابات بعد.","This trial is not connected to the answer engine yet.")}</p>}
 </section>;
}

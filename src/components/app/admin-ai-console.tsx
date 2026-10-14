"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {useDemo} from "@/lib/demo-state";
import {readAdminAIState,runAdminAITrial} from "@/lib/answers/runtime/admin-actions";
import type {AdminAIActionInput,AdminAIState} from "@/lib/answers/runtime/admin-types";
import {Button,Notice} from "./ui";
import styles from "./admin-ai-console.module.css";
import {SyntheticGeminiConsole} from "./synthetic-gemini-console";
import type {SyntheticGeminiFreeState} from "@/lib/answers/runtime/synthetic-gemini-types";

const models=["gpt-6-luna","gemini-3.8-flash","gpt-6.1-sol"] as const;
const labels:Record<string,string>={success:"نجح",incomplete:"رد غير مكتمل",rejected:"رفض المزود",uncertain:"تكلفة تحتاج مراجعة",running:"قيد التنفيذ",reserved:"تم حجز الميزانية"};
const messages:Record<string,string>={BUDGET_EXCEEDED:"المتبقي لا يغطي الحد الأقصى للطلب. لم يتم الاتصال بالنموذج.",BUDGET_DISABLED:"ميزانية التجارب متوقفة.",NO_KNOWLEDGE:"لا توجد معرفة معتمدة لهذه الشركة. جرّب فحص الاتصال أو اعتمد مصادر المعرفة أولًا.",APPROVAL_FOUNDATION_UNAVAILABLE:"تجهيز اعتماد المعرفة غير مكتمل في قاعدة البيانات. فحص الاتصال متاح.",KEY_MISSING:"مفتاح المزود غير موجود في إعدادات السيرفر.",PROVIDER_HTTP_401:"المزود رفض المفتاح. راجع صلاحية المفتاح وحسابه.",PROVIDER_HTTP_403:"الحساب لا يملك صلاحية تنفيذ هذا الطلب لدى المزود.",PROVIDER_HTTP_404:"النموذج غير متاح على نقطة الاتصال لهذا الحساب.",PROVIDER_HTTP_429:"المزود رفض الطلب بسبب الحصة أو الرصيد أو معدل الطلبات.",PROVIDER_NETWORK_ERROR:"الاتصال غير مؤكد؛ الميزانية المحجوزة محفوظة لحين مراجعة الاستهلاك.",SETTLEMENT_PENDING_RECONCILIATION:"وصل الطلب للمزود لكن تأكيد حفظ الاستهلاك تعذّر. الحجز محفوظ لتجنب تجاوز الميزانية.",DUPLICATE_REQUEST:"تم استخدام رقم الطلب بالفعل؛ لن نرسل طلبًا مكررًا."};
function validRefreshSnapshot(value:AdminAIState){
 const budget=value?.budget;
 return !!budget&&typeof budget.enabled==="boolean"
  &&[budget.limit_baisa,budget.spent_baisa,budget.held_baisa].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0)
  &&Array.isArray(value.companies)&&Array.isArray(value.models)&&Array.isArray(value.recent)
  &&value.models.every(row=>[row.attempts,row.succeeded,row.cost_baisa].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0));
}
export function AdminAIConsole({initial,freeState}:{initial:AdminAIState;freeState?:SyntheticGeminiFreeState}){
 const {locale}=useDemo(),ar=locale==="ar";
 const [snapshot,setSnapshot]=useState<{source:AdminAIState;data:AdminAIState|null}>({source:initial,data:initial}),[companyId,setCompanyId]=useState(initial.companies.find(c=>c.status!=="suspended")?.id??""),[model,setModel]=useState<AdminAIActionInput["model"]>("gpt-6-luna"),[contextMode,setContextMode]=useState<AdminAIActionInput["contextMode"]>("connection"),[question,setQuestion]=useState("هذا فحص اتصال. أكّدي وصول الرسالة باختصار."),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[result,setResult]=useState<Awaited<ReturnType<typeof runAdminAITrial>>|null>(null);
 const [freeAttempted,setFreeAttempted]=useState(false);
 const state=snapshot.source===initial?snapshot.data:initial;
 const refreshScope=useMemo(()=>({initial,locale}),[initial,locale]);
 const refreshRequest=useRef<{scope:typeof refreshScope;active:boolean;pending:boolean;failed:boolean}|null>(null);
 const [refreshState,setRefreshState]=useState<{scope:typeof refreshScope;pending:boolean;failed:boolean}|null>(null);
 const refreshing=refreshState?.scope===refreshScope&&refreshState.pending;
 const [refreshFailure,setRefreshFailure]=useState<{initial:typeof initial;failed:boolean}|null>(null);
 const refreshFailed=refreshFailure?.initial===initial&&refreshFailure.failed;
 useEffect(()=>{
  const previous=refreshRequest.current;
  const request={scope:refreshScope,active:true,pending:false,failed:previous?.scope.initial===refreshScope.initial&&previous.failed};
  refreshRequest.current=request;
  return()=>{request.active=false;};
 },[refreshScope]);
 const refreshMessage=ar?"تعذّر تحديث الاستهلاك. تعرض آخر بيانات مؤكدة عند توفرها؛ حدّث بنجاح قبل تجربة أخرى.":"Could not refresh usage. Last confirmed data is shown when available; refresh successfully before another trial.";
 const refreshControl=<Button type="button" variant="secondary" busy={refreshing} busyLabel={ar?"جارٍ تحديث الاستهلاك…":"Refreshing usage…"} disabled={busy||refreshing} onClick={()=>void refresh()}>{ar?"تحديث الاستهلاك":"Refresh usage"}</Button>;
 const refreshNotice=refreshFailed?<div role="alert"><Notice tone="error">{refreshMessage}</Notice></div>:refreshing?<p role="status" aria-live="polite">{ar?"جارٍ تحديث الاستهلاك…":"Refreshing usage…"}</p>:null;
 const budget=state?.budget,remaining=budget?Math.max(0,Number(budget.limit_baisa)-Number(budget.spent_baisa)-Number(budget.held_baisa)):null;
 const money=(baisa:number)=>new Intl.NumberFormat(ar?"ar-OM":"en-OM",{minimumFractionDigits:3,maximumFractionDigits:6}).format(baisa/1000);
 async function refresh(){
  const request=refreshRequest.current;
  if(!request||request.scope!==refreshScope||!request.active||request.pending)return;
  request.pending=true;
  setRefreshState({scope:refreshScope,pending:true,failed:request.failed});
  try{
   const value=await readAdminAIState();
   if(!request.active)return;
   if(value.ok&&validRefreshSnapshot(value.data)){
    request.failed=false;
    setSnapshot({source:initial,data:value.data});
    setCompanyId(current=>value.data.companies.some(c=>c.id===current&&c.status!=="suspended")?current:value.data.companies.find(c=>c.status!=="suspended")?.id??"");
   }else{
    request.failed=true;
    if(!value.ok&&["OWNER_REQUIRED","FORBIDDEN","UNAUTHENTICATED","UNVERIFIED","SESSION_UNAVAILABLE"].includes(value.error))setSnapshot({source:initial,data:null});
   }
  }catch{
   if(request.active)request.failed=true;
  }finally{
   if(request.active){
    request.pending=false;
    setRefreshState({scope:refreshScope,pending:false,failed:request.failed});
    setRefreshFailure({initial,failed:request.failed});
   }
  }
 }
 async function submit(e:React.FormEvent){e.preventDefault();const request=refreshRequest.current;if(busy||!request||request.scope!==refreshScope||!request.active||request.pending||request.failed)return;setBusy(true);setError(null);setResult(null);try{
  const value=await runAdminAITrial({companyId,model,contextMode,question,executionId:crypto.randomUUID(),locale});setResult(value);
  if(!value.ok)setError(ar?(messages[value.error]??`تعذّر تنفيذ التجربة (${value.error}).`):value.error);
  await refresh();
 }catch{setError(ar?"تعذّر تأكيد نتيجة الطلب. راجع سجل الاستهلاك قبل إعادة التجربة.":"Could not confirm the result. Check usage before retrying.");await refresh();}finally{setBusy(false);}}
 if(!state||!budget||remaining===null)return <section className={styles.console} dir={ar?"rtl":"ltr"}><h1>{ar?"تجارب الذكاء الفعلية":"Real AI trials"}</h1>{refreshNotice}{refreshControl}</section>;
 return <section className={styles.console} dir={ar?"rtl":"ltr"}>
  <header className={styles.header}><div><p className={styles.kicker}>Velora AI</p><h1>{ar?"تجربة الذكاء الفعلية":"Real AI trials"}</h1><p>{ar?"ردود من النماذج الحقيقية، باستهلاك محفوظ وسقف مستقل لتجارب مالك المنصة.":"Actual model responses with durable usage and a separate owner trial budget."}</p></div><Link href="/admin">{ar?"لوحة الإدارة":"Administration"}</Link></header>
  <div className={styles.balance}><div><span>{ar?"متبقي للتجارب":"Trial balance"}</span><strong><bdi>{money(remaining)}</bdi> <small>{ar?"ر.ع":"OMR"}</small></strong></div><p>{ar?"السقف الإجمالي: 1 ر.ع. لا يتجدد تلقائيًا، ولا يُخصم من اشتراك الشركة.":"Total cap: 1 OMR. No automatic reset; company subscriptions are not charged."}<br/>{ar?"المستخدم":"Spent"}: <bdi>{money(Number(budget.spent_baisa))}</bdi> · {ar?"المحجوز":"Held"}: <bdi>{money(Number(budget.held_baisa))}</bdi></p>{refreshControl}</div>
  <p className="text-sm">{ar?'التكلفة المسجلة محسوبة من استهلاك التوكنز وتسعيرة المحاولة المحفوظة؛ فاتورة المزود النهائية تحتاج المطابقة.':'Recorded cost is calculated from token usage and the saved attempt pricing; the final provider invoice requires reconciliation.'}</p>
  {refreshNotice}
  <SyntheticGeminiConsole initial={freeState??{ready:false,code:"FREE_SYNTHETIC_NEEDS_SETUP"}} ar={ar} attemptedBefore={freeAttempted} onAttempt={()=>setFreeAttempted(true)}/>
  {error?<Notice tone="error">{error}</Notice>:null}
  <div className={styles.workspace}><form onSubmit={submit} className={styles.form}>
   <h2>{ar?"جرّب طلبًا":"Try a request"}</h2>
   <label>{ar?"الشركة المرتبطة بالسجل":"Company for the ledger"}<select value={companyId} onChange={e=>setCompanyId(e.target.value)} disabled={busy}>{state.companies.filter(c=>c.status!=="suspended").map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <div className={styles.fields}><label>{ar?"النموذج":"Model"}<select value={model} onChange={e=>setModel(e.target.value as AdminAIActionInput["model"])} disabled={busy}><option value="auto">{ar?"توجيه تلقائي":"Automatic routing"}</option>{models.map(m=><option key={m} value={m}>{m}</option>)}</select></label><label>{ar?"مصدر المعلومات":"Knowledge source"}<select value={contextMode} onChange={e=>setContextMode(e.target.value as AdminAIActionInput["contextMode"])} disabled={busy}><option value="connection">{ar?"فحص اتصال فقط":"Connection check"}</option><option value="company">{ar?"معرفة الشركة المعتمدة":"Approved company knowledge"}</option></select></label></div>
   <label>{ar?"السؤال":"Question"}<textarea value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1000} rows={5} disabled={busy} required/></label>
   <p className={styles.note}>{ar?"الزر يرسل طلبًا فعليًا مدفوعًا. تُحجز تكلفة كل محاولة قبل تنفيذها، ويُحفظ استهلاكها بعد الرد. لا تصل هذه التجربة إلى العملاء.":"This button sends a real paid request. Each attempt reserves funds before execution and records its usage afterward. Trials do not reach customers."}</p>
   <Button type="submit" busy={busy} busyLabel={ar?"جارٍ الاتصال بالنموذج…":"Calling the model…"} disabled={refreshing||refreshFailed||!companyId||!budget.enabled||remaining<=0||!question.trim()}>{ar?"تشغيل تجربة فعلية":"Run real trial"}</Button>
  </form><div className={styles.response} aria-live="polite"><h2>{ar?"الرد ونتيجة الاتصال":"Response and connection result"}</h2>{result&&"text" in result?<><p className={styles.model}>{result.model}</p><p className={styles.answer}>{result.text|| (ar?"المزود لم يُرجع نصًا، لكن استهلاكه سُجّل.":"The provider returned no text; usage was recorded.")}</p>{!result.complete?<Notice tone="warn">{ar?"الرد غير مكتمل عند حد الإخراج. تم حفظ الاستهلاك، ولم يُكرر الطلب تلقائيًا.":"Incomplete at the output limit. Usage was recorded; no automatic retry."}</Notice>:null}</>:<p className={styles.empty}>{ar?"اختر الشركة والنموذج، ثم نفّذ التجربة لعرض الرد الحقيقي هنا.":"Choose a company and model, then run a trial to see the actual response."}</p>}{result&&"attempts" in result?result.attempts.map(a=><div className={styles.attempt} key={a.id}><bdi>{a.model}</bdi><span>{ar?(labels[a.status]??a.status):a.status}</span><span>{a.costBaisa===null?(ar?"الحجز محفوظ":"Funds held"):`${money(a.costBaisa)} ${ar?"ر.ع":"OMR"}`}</span>{a.message?<small>{a.message}</small>:null}</div>):null}</div></div>
  <div className={styles.models}>{models.map(m=>{const usage=state.models.find(v=>v.model_id===m);return <div key={m}><bdi>{m}</bdi><strong>{usage?.succeeded??0}</strong><span>{ar?"طلبات ناجحة محفوظة":"Recorded successful requests"}</span><small><bdi>{money(Number(usage?.cost_baisa??0))}</bdi> {ar?"ر.ع":"OMR"}</small></div>;})}</div>
  <section className={styles.history}><h2>{ar?"آخر المحاولات المسجّلة":"Recent recorded attempts"}</h2><div className={styles.tableWrap}><table><thead><tr>{(ar?["النموذج","الحالة","التوكنز: إدخال / إخراج","التكلفة بالريال","وقت التنفيذ"]:["Model","Status","Tokens: input / output","Cost in OMR","Time"]).map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{state.recent.map(row=><tr key={row.id}><td><bdi>{row.model_id}</bdi></td><td>{ar?(labels[row.status]??row.status):row.status}{row.error_code?<small>{row.error_code}</small>:null}</td><td><bdi>{row.prompt_tokens??"—"} / {row.completion_tokens??"—"}</bdi></td><td>{row.cost_baisa===null?(ar?"محجوز":"Held"):money(Number(row.cost_baisa))}</td><td>{new Date(row.created_at).toLocaleString(ar?"ar-OM":"en-OM",{timeZone:"Asia/Muscat"})}</td></tr>)}</tbody></table></div>{!state.recent.length?<p className={styles.empty}>{ar?"لا يوجد استهلاك مسجّل بعد.":"No recorded usage yet."}</p>:null}</section>
 </section>;
}

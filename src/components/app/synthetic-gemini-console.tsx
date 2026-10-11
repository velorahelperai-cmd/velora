"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { readSyntheticGeminiFreeState, runSyntheticGeminiFreeTest } from "@/lib/answers/runtime/synthetic-gemini-actions";
import type { SyntheticGeminiFreeState } from "@/lib/answers/runtime/synthetic-gemini-types";
import { Button, Notice } from "./ui";
import styles from "./admin-ai-console.module.css";
export function SyntheticGeminiConsole({initial,ar,attemptedBefore=false,onAttempt}:{initial:SyntheticGeminiFreeState;ar:boolean;attemptedBefore?:boolean;onAttempt?:()=>void}) {
 const refreshScope=useMemo(()=>({initial,ar}),[initial,ar]);
 const [snapshot,setSnapshot]=useState({source:initial,data:initial});
 const state=snapshot.source===initial?snapshot.data:initial;
 const [confirmation,setConfirmation]=useState<{scope:typeof refreshScope;checked:boolean}|null>(null);
 const confirmed=confirmation?.scope===refreshScope&&confirmation.checked;
 const [busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false);
 const hasAttempted=attempted||attemptedBefore;
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
 const [result,setResult]=useState<Awaited<ReturnType<typeof runSyntheticGeminiFreeTest>>|null>(null);
 const lock=useRef(false);
 async function refresh(){
  const request=refreshRequest.current;
  if(busy||!request||request.scope!==refreshScope||!request.active||request.pending)return;
  request.pending=true;
  setRefreshState({scope:refreshScope,pending:true,failed:request.failed});
  try{
   const next=await readSyntheticGeminiFreeState();
   if(!request.active)return;
   if(next.ok&&typeof next.data?.ready==="boolean"&&typeof next.data.code==="string"){
    request.failed=false;
    setSnapshot({source:initial,data:next.data});
   }else{
    request.failed=true;
    if(!next.ok)setSnapshot({source:initial,data:{ready:false,code:next.error}});
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
 async function submit(event:React.FormEvent){event.preventDefault();const request=refreshRequest.current;if(lock.current||hasAttempted||!confirmed||!state.ready||!request||request.scope!==refreshScope||!request.active||request.pending||request.failed)return;lock.current=true;setAttempted(true);onAttempt?.();setBusy(true);
  try{setResult(await runSyntheticGeminiFreeTest({executeConfirmed:true}));}
  catch{setResult({ok:false,error:"SYNTHETIC_OUTCOME_UNVERIFIED"});}
  finally{setBusy(false);}
 }
 return <section className={styles.form} aria-labelledby="gemini-free-title">
  <h2 id="gemini-free-title">{ar?"اختبار Gemini المجاني الاصطناعي":"Gemini Free synthetic test"}</h2>
  <p className={styles.note}>{ar?"طلب اتصال واحد بنص ثابت غير شخصي، دون بيانات العملاء. قد تستخدم Google محتوى الخطة المجانية لتحسين منتجاتها. لا إعادة تلقائية ولا انتقال لخطة مدفوعة.":"One connectivity request with a fixed nonpersonal prompt and no customer data. Google may use Free-tier content to improve its products. No automatic retry or paid fallback."}</p>
  {state.ready?<p><bdi>{state.projectRef} · {state.modelId}</bdi><br/>{ar?"تنتهي الموافقة المحدودة في: ":"Scoped approval expires: "}<bdi>{state.expiresAt}</bdi></p>:<Notice tone="warn">{ar?"الاختبار غير متاح حتى اكتمال الإعداد المعتمد.":"The test is unavailable until approved setup is complete."} <bdi>{state.code}</bdi></Notice>}
  <form onSubmit={submit}>
   <label><input type="checkbox" checked={confirmed} disabled={!state.ready||hasAttempted||busy||refreshing||refreshFailed} onChange={event=>setConfirmation({scope:refreshScope,checked:event.target.checked})}/>{" "}{ar?"أؤكد تنفيذ طلب اصطناعي مجاني واحد فقط.":"I confirm one synthetic Free-tier request only."}</label>
   <Button type="submit" disabled={!state.ready||!confirmed||hasAttempted||refreshing||refreshFailed} busy={busy} busyLabel={ar?"جارٍ التحقق من الطلب…":"Verifying the request…"}>{ar?"تنفيذ الاختبار المجاني مرة واحدة":"Run Free test once"}</Button>
  </form>
  <Button type="button" variant="secondary" busy={refreshing} busyLabel={ar?"جارٍ تحديث الجاهزية…":"Refreshing readiness…"} disabled={busy||refreshing} onClick={()=>void refresh()}>{ar?"تحديث جاهزية الاختبار":"Refresh test readiness"}</Button>
  {refreshFailed?<div role="alert"><Notice tone="error">{ar?"تعذّر تحديث الجاهزية. تعرض آخر بيانات مؤكدة عند توفرها؛ حدّث بنجاح قبل تنفيذ الاختبار.":"Could not refresh readiness. Last confirmed data is shown when available; refresh successfully before running the test."}</Notice></div>:refreshing?<p role="status" aria-live="polite">{ar?"جارٍ تحديث الجاهزية…":"Refreshing readiness…"}</p>:null}
  <div role="status" aria-live="polite">{result?(result.ok?<Notice tone="success"><bdi>{"text" in result?result.text:"VELORA_SYNTHETIC_OK"}</bdi> {ar?"تم التحقق من الرد وحفظ استخدامه.":"Response and usage verified."}</Notice>:<Notice tone="warn"><bdi>{result.error}</bdi> {ar?"تحقق من سجل الاستخدام. لن يعاد إرسال هذا الطلب تلقائياً.":"Check the usage ledger. This request will not be retried automatically."}</Notice>):null}</div>
 </section>;
}

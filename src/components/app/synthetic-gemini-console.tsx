"use client";
import { useRef, useState } from "react";
import { readSyntheticGeminiFreeState, runSyntheticGeminiFreeTest } from "@/lib/answers/runtime/synthetic-gemini-actions";
import type { SyntheticGeminiFreeState } from "@/lib/answers/runtime/synthetic-gemini-types";
import { Button, Notice } from "./ui";
import styles from "./admin-ai-console.module.css";
export function SyntheticGeminiConsole({initial,ar}:{initial:SyntheticGeminiFreeState;ar:boolean}) {
 const [state,setState]=useState(initial),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false);
 const [result,setResult]=useState<Awaited<ReturnType<typeof runSyntheticGeminiFreeTest>>|null>(null);
 const lock=useRef(false);
 async function refresh(){ if(busy)return; const next=await readSyntheticGeminiFreeState();setState(next.ok?next.data:{ready:false,code:next.error}); }
 async function submit(event:React.FormEvent){event.preventDefault();if(lock.current||attempted||!confirmed||!state.ready)return;lock.current=true;setAttempted(true);setBusy(true);
  try{setResult(await runSyntheticGeminiFreeTest({executeConfirmed:true}));}
  catch{setResult({ok:false,error:"SYNTHETIC_OUTCOME_UNVERIFIED"});}
  finally{setBusy(false);}
 }
 return <section className={styles.form} aria-labelledby="gemini-free-title">
  <h2 id="gemini-free-title">{ar?"اختبار Gemini المجاني الاصطناعي":"Gemini Free synthetic test"}</h2>
  <p className={styles.note}>{ar?"طلب اتصال واحد بنص ثابت غير شخصي، دون بيانات العملاء. قد تستخدم Google محتوى الخطة المجانية لتحسين منتجاتها. لا إعادة تلقائية ولا انتقال لخطة مدفوعة.":"One connectivity request with a fixed nonpersonal prompt and no customer data. Google may use Free-tier content to improve its products. No automatic retry or paid fallback."}</p>
  {state.ready?<p><bdi>{state.projectRef} · {state.modelId}</bdi><br/>{ar?"تنتهي الموافقة المحدودة في: ":"Scoped approval expires: "}<bdi>{state.expiresAt}</bdi></p>:<Notice tone="warn">{ar?"الاختبار غير متاح حتى اكتمال الإعداد المعتمد.":"The test is unavailable until approved setup is complete."} <bdi>{state.code}</bdi></Notice>}
  <form onSubmit={submit}>
   <label><input type="checkbox" checked={confirmed} disabled={!state.ready||attempted||busy} onChange={event=>setConfirmed(event.target.checked)}/>{" "}{ar?"أؤكد تنفيذ طلب اصطناعي مجاني واحد فقط.":"I confirm one synthetic Free-tier request only."}</label>
   <Button type="submit" disabled={!state.ready||!confirmed||attempted} busy={busy} busyLabel={ar?"جارٍ التحقق من الطلب…":"Verifying the request…"}>{ar?"تنفيذ الاختبار المجاني مرة واحدة":"Run Free test once"}</Button>
  </form>
  <Button type="button" variant="secondary" disabled={busy} onClick={()=>void refresh()}>{ar?"تحديث جاهزية الاختبار":"Refresh test readiness"}</Button>
  <div role="status" aria-live="polite">{result?(result.ok?<Notice tone="success"><bdi>{"text" in result?result.text:"VELORA_SYNTHETIC_OK"}</bdi> {ar?"تم التحقق من الرد وحفظ استخدامه.":"Response and usage verified."}</Notice>:<Notice tone="warn"><bdi>{result.error}</bdi> {ar?"تحقق من سجل الاستخدام. لن يعاد إرسال هذا الطلب تلقائياً.":"Check the usage ledger. This request will not be retried automatically."}</Notice>):null}</div>
 </section>;
}

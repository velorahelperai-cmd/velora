"use client";
import Link from "next/link";
import {useEffect,useLayoutEffect,useRef,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {useDemo} from "@/lib/demo-state";
import {useOptionalAccountSession} from "./account-chrome";
import {Button,Field,Notice} from "./ui";
import {beginPersonalPhoneChangeAction,readPersonalPhoneChangeStatus,resendCurrentPhoneAction,sendReplacementPhoneAction,verifyPhoneChangeStepAction} from "@/lib/tenancy/personal-phone-change-actions";
import type {PersonalPhoneChangeStatus} from "@/lib/tenancy/personal-phone-change";
import {normalizePersonalPhone,type PersonalPhoneResult} from "@/lib/tenancy/personal-phone";
export function PersonalPhoneChangePanel({userId,onCompleted}:{userId:string;onCompleted?:()=>void}){
 const {locale}=useDemo(),ar=locale==="ar",router=useRouter(),session=useOptionalAccountSession();
 const sessionRef=useRef(session);useLayoutEffect(()=>{sessionRef.current=session;},[session]);const mounted=useRef(true),busyRef=useRef(false),request=useRef<{phone:string;key:string}|null>(null);
 const [status,setStatus]=useState<PersonalPhoneChangeStatus|null>(null),[phone,setPhone]=useState(""),[code,setCode]=useState(""),[busy,setBusy]=useState(false),[failure,setFailure]=useState<string|null>(null);
 const t=(en:string,arabic:string)=>ar?arabic:en;
 const active=Boolean(!session||session.status==="ready"&&session.identity?.userId===userId);
 const current=()=>{const s=sessionRef.current;return mounted.current&&(!s||s.status==="ready"&&s.identity?.userId===userId);};
 async function refresh(){const r=await readPersonalPhoneChangeStatus(userId);if(!current())return;if(r.ok)setStatus(r.data);else setFailure(r.code);}
 useEffect(()=>{mounted.current=true;void readPersonalPhoneChangeStatus(userId).then(r=>{const s=sessionRef.current;if(!mounted.current||s&&(s.status!=="ready"||s.identity?.userId!==userId))return;if(r.ok)setStatus(r.data);else setFailure(r.code);});return()=>{mounted.current=false;};},[userId]);
 async function perform(op:()=>Promise<PersonalPhoneResult>){if(!current()||busyRef.current)return;busyRef.current=true;setBusy(true);setFailure(null);try{const r=await op();if(!current())return;if(!r.ok)setFailure(r.code);else request.current=null;if(r.ok&&r.data.step==="complete"){await sessionRef.current?.refresh();if(!current())return;onCompleted?.();router.refresh();}await refresh();}catch{if(current())setFailure("UNAVAILABLE");}finally{busyRef.current=false;if(current())setBusy(false);}}
 function begin(e:FormEvent){e.preventDefault();const target=normalizePersonalPhone(phone);if(!target){setFailure("INVALID_INPUT");return;}if(status?.change?.step==="expired"||status?.change?.step==="complete")request.current=null;if(!request.current||request.current.phone!==target)request.current={phone:target,key:crypto.randomUUID()};const key=request.current.key;void perform(()=>beginPersonalPhoneChangeAction({expectedUserId:userId,newPhone:target,requestKey:key}));}
 function verify(e:FormEvent){e.preventDefault();if(!status?.change?.intent)return;const input={expectedUserId:userId,intentId:status.change.intent.id,code};setCode("");void perform(()=>verifyPhoneChangeStepAction(input));}
 const displayed=status?.userId===userId?status:null,c=displayed?.change,disabled=busy||!active||displayed?.configuration!=="CONFIGURED",canVerify=c&&(c.step==="old_pending"||c.step==="new_pending")&&(c.intent?.state==="sent"||c.intent?.state==="verifying");
 if(!active)return <Notice>{t("Waiting for your current account.","جارٍ التحقق من حسابك الحالي.")}</Notice>;
 return <section className="grid gap-4 border-t border-[var(--color-border)] pt-5" dir={ar?"rtl":"ltr"}>
  <h2 className="font-semibold">{t("Change personal phone","تغيير الهاتف الشخصي")}</h2>
  <p className="text-sm text-[var(--color-text-secondary)]">{t("Verify your current phone first, then the new phone. Your current number stays linked until native verification confirms the replacement.","وثّق هاتفك الحالي أولًا ثم الهاتف الجديد. يبقى رقمك الحالي مرتبطًا حتى تأكيد توثيق البديل.")}</p>
  {displayed?.configuration==="UNCONFIGURED"?<Notice tone="warn">{t("SMS delivery is not configured yet. Your current verified phone remains valid.","إرسال SMS غير مهيّأ بعد. يبقى هاتفك الحالي الموثق صالحًا.")}</Notice>:null}
  {!c||c.step==="expired"||c.step==="complete"?<form onSubmit={begin} className="grid gap-3"><Field label={t("New personal phone","الهاتف الشخصي الجديد")} required>{p=><input {...p} type="tel" dir="ltr" value={phone} maxLength={40} autoComplete="tel" onChange={e=>{setPhone(e.target.value);request.current=null;}} disabled={disabled} required/>}</Field><Button type="submit" disabled={disabled} busy={busy}>{t("Send code to current phone","إرسال رمز للهاتف الحالي")}</Button></form>:null}
  {c&&c.step!=="complete"?<p className="text-sm">{t("Current phone","الهاتف الحالي")} <b dir="ltr">{c.oldPhoneMasked}</b> · {t("Replacement","البديل")} <b dir="ltr">{c.newPhoneMasked}</b></p>:null}
  {c?.step==="old_verified"?<Button disabled={disabled} busy={busy} onClick={()=>{const changeId=c.id,key=crypto.randomUUID();void perform(()=>sendReplacementPhoneAction({expectedUserId:userId,changeId,requestKey:key}));}}>{t("Send code to new phone","إرسال رمز للهاتف الجديد")}</Button>:null}
  {c&&(c.step==="old_pending"||c.step==="new_pending")?<Button variant="secondary" disabled={disabled} busy={busy} onClick={()=>{if(c.intent&&Date.parse(c.intent.resendAt)>Date.now()){setFailure("COOLDOWN");return;}const input={expectedUserId:userId,changeId:c.id,requestKey:crypto.randomUUID()};void perform(()=>c.step==="old_pending"?resendCurrentPhoneAction(input):sendReplacementPhoneAction(input));}}>{t("Resend SMS code","إعادة إرسال رمز SMS")}</Button>:null}
  {canVerify?<form onSubmit={verify} className="grid gap-3"><Field label={c.step==="old_pending"?t("Code from current phone","رمز الهاتف الحالي"):t("Code from new phone","رمز الهاتف الجديد")} required>{p=><input {...p} dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} disabled={disabled} required/>}</Field><Button type="submit" disabled={disabled||code.length!==6} busy={busy}>{t("Verify code","توثيق الرمز")}</Button></form>:null}
  {c?.step==="complete"?<Notice tone="success">{t("Both phones were verified. The new personal phone is linked to the same account; other sessions have been invalidated.","تم توثيق الهاتفين. ارتبط الهاتف الجديد بالحساب نفسه، وأُبطلت الجلسات الأخرى.")}</Notice>:null}
  {failure&&active?<Notice tone="error">{failure==="UNCONFIGURED"?t("SMS delivery is not configured.","إرسال SMS غير مهيّأ."):failure==="COOLDOWN"?t("Wait one minute before resending.","انتظر دقيقة قبل إعادة الإرسال."):failure==="CODE_INVALID"?t("The SMS code was not confirmed. Check saved status before retrying.","لم يُؤكّد رمز SMS. تحقّق من الحالة المحفوظة قبل المحاولة مجددًا."):failure==="PHONE_IN_USE"?t("This number belongs to an existing account. Use its recovery review.","هذا الرقم مرتبط بحساب قائم. استخدم مراجعة استرداده."):t("The change could not be confirmed. Check saved status; your account identity has not been transferred.","تعذّر تأكيد التغيير. تحقّق من الحالة المحفوظة؛ لم تُنقل هوية الحساب.")}</Notice>:null}
  <Button variant="secondary" busy={busy} disabled={busy||!active} onClick={()=>void refresh()}>{t("Check saved change","التحقق من التغيير المحفوظ")}</Button>
  <Link href="/account/recovery" className="text-sm text-[var(--color-action-on-dark)]">{t("Lost access to your old phone? Open recovery review","فقدت الوصول للهاتف القديم؟ افتح مراجعة استرداد")}</Link>
 </section>;
}

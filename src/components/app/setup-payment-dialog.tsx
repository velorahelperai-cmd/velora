"use client";
import {startTransition,useEffect,useRef,useState} from 'react';
import {verifyThawaniPayment,finishTestCheckout} from '@/app/account/payment/[orderId]/actions';
import {es02Uuid} from '@/lib/billing/es02/contracts';
import {AccessibleDialog} from './accessible-dialog';
import {SetupOrderReview,safeTestCheckoutUrl,type SetupOrderReviewProps} from './setup-order-review';
import {actorKey,createLiveCell} from './setup-order-review-model';
import type {SetupPlanConfirmResult} from './setup-plan-journey';
import styles from './setup-payment-dialog.module.css';
import reviewStyles from './setup-order-review.module.css';
import {readQaSetupSimulationAccess} from '@/lib/tenancy/qa-setup-simulation-actions';
import {grantQaBusiness} from '@/lib/tenancy/qa-business-grant-actions';
import type {Preparation} from '@/lib/tenancy/prepayment-preparation';

type Props=SetupOrderReviewProps&{isCurrent:()=>boolean;navigate?:(next:string)=>void;qaPreparation?:Preparation};
type Payment={orderId:string;url:string|null};
type Phase='idle'|'creating'|'waiting'|'checking'|'paid'|'unknown'|'setup_failed'|'finished';
export function SetupPaymentDialog(p:Props){return <PaymentDialog key={JSON.stringify(p.actor)} {...p}/>;}

function PaymentDialog(p:Props){
 const [qaAllowed,setQaAllowed]=useState(false);
 const [qaBusy,setQaBusy]=useState(false),[qaConfirm,setQaConfirm]=useState(false);
 const qaOperation=useRef<string|null>(null),qaFlight=useRef(false);
 const qaAccountId=p.actor.accountId,qaCurrent=p.isCurrent;
 useEffect(()=>{let active=true;void readQaSetupSimulationAccess(qaAccountId).then(allowed=>{if(active&&qaCurrent())setQaAllowed(allowed);}).catch(()=>{});return()=>{active=false;};},[qaAccountId,qaCurrent]);
 const t=(a:string,e:string)=>p.ar?a:e;
 const stored=p.write.kind==='unpaid'&&p.write.order.accountId===p.actor.accountId&&es02Uuid(p.write.order.orderId)?{orderId:p.write.order.orderId,url:safeTestCheckoutUrl(p.write.checkoutUrl)}:null;
 const [payment,setPayment]=useState<Payment|null>(stored),[phase,setPhase]=useState<Phase>(stored?'waiting':'idle');
 const [notice,setNotice]=useState(''),[open,setOpen]=useState(true);
 const [paidConfirmed,setPaidConfirmed]=useState(false);
 const [automaticStopped,setAutomaticStopped]=useState(false);
 const popup=useRef<Window|null>(null),mounted=useRef(false),creating=useRef(false),paid=useRef(false),flight=useRef(false);
 const [live]=useState(()=>{const cell=createLiveCell(p,actorKey(p.actor));return {sync:cell.sync,getProps:()=>cell.props};});live.sync(p,actorKey(p.actor),false,false);
 const activeNow=p.isCurrent();
 const wake=useRef<()=>void>(()=>{});
 const current=()=>mounted.current&&live.getProps().isCurrent();
 const closePopup=()=>{try{popup.current?.close();}catch{/* Parent recovery does not depend on a popup handle. */}popup.current=null;};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;closePopup();};},[]);
 useEffect(()=>{if(!activeNow)closePopup();},[activeNow]);

 function openPopup(){
  if(!current())return false;
  try{
   if(popup.current&&!popup.current.closed){popup.current.focus();return true;}
   const child=window.open('about:blank','_blank','popup=yes,width=500,height=740,resizable=yes,scrollbars=yes');
   if(!child){setNotice(t('اسمح بالنوافذ المنبثقة لفتح الدفع الآمن، ثم أعد المحاولة.','Allow popups to open secure checkout, then try again.'));return false;}
   popup.current=child;
   child.opener=null;
   child.document.title=t('الدفع الآمن','Secure checkout');
   if(child.document.body)child.document.body.textContent=t('جارٍ تجهيز الدفع الآمن…','Preparing secure checkout…');
   return true;
  }catch{closePopup();setNotice(t('تعذر فتح نافذة الدفع. أعد المحاولة.','Could not open the payment window. Try again.'));return false;}
 }
 function beforeConfirm(){
  if(qaFlight.current||creating.current||!current()||!openPopup())return false;
  creating.current=true;setPhase('creating');setNotice('');return true;
 }
 async function confirm(invoke:()=>Promise<SetupPlanConfirmResult>){
  try{
   const result=await invoke();
   if(current()&&!result.ok){closePopup();setPhase('idle');}
   return result;
  }catch(error){if(current()){closePopup();setPhase('idle');}throw error;}
  finally{creating.current=false;if(!current())closePopup();}
 }
 function confirmed(result:Extract<SetupPlanConfirmResult,{ok:true}>){
  if(!current()||result.order.accountId!==p.actor.accountId||!es02Uuid(result.order.orderId))return;
  const url=safeTestCheckoutUrl(result.checkoutUrl);
  setPayment({orderId:result.order.orderId,url});setPhase('waiting');
  if(!url){closePopup();setNotice(t('تعذر فتح الدفع لهذا الطلب. احتفظنا بنفس الطلب للتحقق من حالته.','Checkout could not be opened. The same order is retained for status recovery.'));return;}
  try{if(popup.current&&!popup.current.closed)popup.current.location.replace(url);}
  catch{setNotice(t('أعد فتح نافذة الدفع لنفس الطلب.','Reopen the payment window for this order.'));}
 }
 function resume(){
  if(!current())return;
  if(!payment?.url){
   if(!p.retrySameOperation||!beforeConfirm())return;
   void confirm(p.retrySameOperation).then(result=>{if(result.ok)confirmed(result);}).catch(()=>{if(current())setNotice(t('لم يتأكد استرجاع نافذة الدفع. تحقق من نفس الطلب.','Checkout recovery is not confirmed. Check the same order.'));});
   return;
  }
  if(!openPopup())return;
  try{popup.current!.location.replace(payment.url);setNotice('');wake.current();}catch{setNotice(t('تعذر فتح نافذة الدفع.','Could not open checkout.'));}
 }
 const orderId=payment?.orderId;
 useEffect(()=>{
  if(!orderId)return;
  let active=true,timer:ReturnType<typeof setTimeout>|undefined;
  let deadline=Date.now()+300_000;
  const valid=()=>active&&mounted.current&&live.getProps().isCurrent();
  const schedule=()=>{
   if(!valid()||paid.current)return;
   if(timer)clearTimeout(timer);
   if(Date.now()<deadline)timer=setTimeout(()=>check(false),10_000);else setAutomaticStopped(true);
  };
  function check(manual:boolean){
   if(!valid())return;
   if(timer){clearTimeout(timer);timer=undefined;}
   if(flight.current){timer=setTimeout(()=>check(false),250);return;}
   if(manual){deadline=Date.now()+300_000;setAutomaticStopped(false);}
   flight.current=true;setPhase(paid.current?'paid':'checking');
   startTransition(async()=>{
    try{
     if(!paid.current){
      const verified=await verifyThawaniPayment(orderId!);
      if(!valid())return;
      if(!verified.ok){setPhase('unknown');return;}
      if(!verified.paid){setPhase('waiting');return;}
      paid.current=true;setPaidConfirmed(true);setPhase('paid');closePopup();
     }
     const result=await finishTestCheckout(orderId!);
     if(!valid())return;
     if(result.ok&&/^\/setup(?:\?branch=[0-9a-f-]{36})?$/i.test(result.next)){
      setPhase('finished');closePopup();
      const navigate=live.getProps().navigate;
      if(navigate)navigate(result.next);else window.location.assign(result.next);
     }else setPhase('setup_failed');
    }catch{if(valid())setPhase(paid.current?'setup_failed':'unknown');}
    finally{flight.current=false;schedule();}
   });
  }
  wake.current=()=>check(true);
  const focused=()=>{if(document.visibilityState!=='hidden')check(false);};
  let channel:BroadcastChannel|undefined;
  try{if(typeof BroadcastChannel!=='undefined'){
   channel=new BroadcastChannel('velora-payment');
   channel.onmessage=event=>{if(event.data?.type==='velora-payment-return'&&event.data.orderId===orderId)check(false);};
  }}catch{/* Storage restrictions may disable BroadcastChannel; polling and focus still work. */}
  window.addEventListener('focus',focused);
  document.addEventListener('visibilitychange',focused);
  check(false);
  return()=>{active=false;if(timer)clearTimeout(timer);channel?.close();window.removeEventListener('focus',focused);document.removeEventListener('visibilitychange',focused);wake.current=()=>{};};
 },[orderId,live]);
 if(!activeNow)return null;
 const busy=qaBusy||phase==='creating'||phase==='checking'||phase==='paid'||phase==='finished';
 const label=paidConfirmed?t('تم تأكيد الدفع','Payment confirmed'):t('بانتظار تأكيد الدفع','Awaiting payment confirmation');
 const paymentStatus=payment?<div className={styles.status}>
  <strong role="status">{paidConfirmed?label:phase==='checking'?t('جارٍ التحقق من الدفع…','Verifying payment…'):label}</strong>
  <p>{phase==='setup_failed'?t('تم تأكيد الدفع. تجهيز نشاطك لم يتأكد بعد؛ أعد متابعة نفس الطلب دون دفع جديد.','Payment confirmed. Business setup could not be confirmed; continue the same order without paying again.'):paidConfirmed?t('جارٍ حفظ نشاطك وفتح التجهيز حسب الباقة…','Saving your business and opening setup for your plan…'):automaticStopped?t('لم يتأكد الدفع بعد. توقفت المتابعة التلقائية؛ يمكنك التحقق من نفس الطلب أو استئناف نافذة الدفع.','Payment is not confirmed yet. Automatic checking paused; check this order or reopen its payment window.'):t('أكمل الدفع في نافذة ثواني. نتحقق من النتيجة هنا تلقائيًا؛ إغلاق النافذة لا يؤكد الدفع.','Complete payment in the Thawani window. We verify it here automatically; closing the window does not confirm payment.')}</p>
  {!paidConfirmed&&<button type="button" data-resume-payment disabled={(!payment.url&&!p.retrySameOperation)||phase==='creating'} onClick={resume}>{t('فتح نافذة الدفع لنفس الطلب','Open payment for this order')}</button>}
  <button type="button" data-check-payment disabled={busy} onClick={()=>wake.current()}>{paidConfirmed?t('متابعة تجهيز النشاط','Continue business setup'):t('التحقق من نفس الطلب','Check this order')}</button>
 </div>:undefined;
 const content=<>
  {notice&&<p className={styles.notice} role="alert">{notice}</p>}
  <SetupOrderReview {...p} beforeConfirm={beforeConfirm} managedCheckout paymentStatus={paymentStatus} paymentStateLabel={payment?label:undefined}
   qaSimulationAction={qaAllowed&&!payment&&!busy&&p.qaPreparation?<div>
    <button type="button" className={reviewStyles.secondary} disabled={qaBusy} onClick={()=>setQaConfirm(true)} data-qa-simulation>{t('تجربة كاملة — VELORA QA','Full VELORA QA experience')}</button>
    {qaConfirm&&<div role="group" aria-label="VELORA QA grant">
     <p>{t('سيُسجّل نشاط VELORA QA والباقة المحددة بمنحة داخلية، دون تحصيل مالي. يبدأ التجهيز الأصلي؛ يستطيع الأدمن أرشفة التجربة وإعادتها.','Create VELORA QA with the selected plan as a non-cash internal grant. Original setup opens; an admin can archive and restart it.')}</p>
     <button type="button" disabled={qaBusy||!p.term} onClick={()=>{if(qaFlight.current||creating.current||!current()||!p.qaPreparation||!p.term)return;qaFlight.current=true;setQaBusy(true);qaOperation.current??=crypto.randomUUID();void grantQaBusiness({accountId:p.actor.accountId,operationId:qaOperation.current,preparation:p.qaPreparation,selection:{term:p.term,slots:p.slots.map(s=>({persona:s.persona!,package:s.package!}))}}).then(r=>{if(!current())return;if(r.ok)(p.navigate??(next=>window.location.assign(next)))('/setup');else setNotice(t('لم يتأكد إنشاء التجربة: ','QA creation not confirmed: ')+r.code);}).catch(()=>{if(current())setNotice('QA: UNKNOWN');}).finally(()=>{qaFlight.current=false;if(current())setQaBusy(false);});}}>{t('تأكيد تسجيل نشاط التجربة','Confirm QA business creation')}</button>
     <button type="button" disabled={qaBusy} onClick={()=>setQaConfirm(false)}>{t('إلغاء','Cancel')}</button>
    </div>}
   </div>:undefined}
   confirmReview={accepted=>confirm(()=>p.confirmReview(accepted))}
   retrySameOperation={p.retrySameOperation?()=>confirm(()=>p.retrySameOperation!()):undefined} onConfirmed={confirmed}/>
 </>;
 return open?<AccessibleDialog label={t('مراجعة الطلب والدفع','Order review and payment')} busy={busy} onClose={()=>setOpen(false)}>
  <div className={styles.dialog} dir={p.ar?'rtl':'ltr'}><div className={styles.bar}><span>{t('طلبك والدفع الآمن','Your order and secure payment')}</span><button type="button" disabled={busy} onClick={()=>setOpen(false)} aria-label={t('إخفاء ديالوج الدفع','Hide payment dialog')}>×</button></div>{content}</div>
 </AccessibleDialog>:<div className={styles.minimized} role="status"><p>{payment?label:t('يمكنك العودة لمراجعة طلبك.','You can return to your order review.')}</p><button type="button" onClick={()=>setOpen(true)}>{t('متابعة الطلب والدفع','Continue order and payment')}</button></div>;
}

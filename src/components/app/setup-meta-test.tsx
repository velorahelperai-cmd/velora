'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useOptionalAccountSession} from './account-chrome';
import {useDemo} from '@/lib/demo-state';
import {PaidSetupStepHost} from './paid-setup-step-host';
import {inspectOwnedSetupMetaTestAction,type SetupMetaTestAccess,type SetupMetaTestInspection} from '@/lib/tenancy/setup-meta-test-actions';
import {confirmSetupLeave} from './paid-setup-unsaved';
import styles from './paid-assistant-checklist.module.css';

const steps=[['whatsapp','رقم Meta التجريبي','Meta test number'],['hours','مواعيد العمل','Business hours'],['knowledge','المعرفة','Knowledge'],['language','لغة الرد','Reply language'],['test','تجربة المساعد','Assistant trial'],['team','دعوة الفريق','Team invitations'],['launch','التشغيل التجاري','Commercial launch']] as const;
type TestStep=(typeof steps)[number][0];
export function SetupMetaTest({initial,companyName}:{initial:SetupMetaTestAccess;companyName:string}){
 const session=useOptionalAccountSession(),{locale}=useDemo(),ar=locale==='ar';
 const [step,setStep]=useState<TestStep>('whatsapp');
 const root=useRef<HTMLElement|null>(null);
 const [inspection,setInspection]=useState<SetupMetaTestInspection|null>(null),[busy,setBusy]=useState(false);
 const [expired,setExpired]=useState(()=>Date.parse(initial.expiresAt)<=Date.now());
 const identity=session?.identity,boundary=session?.boundaryFingerprint;
 const isCurrent=useCallback(()=>{
  if(expired||Date.parse(initial.expiresAt)<=Date.now()||!session||session.status!=='ready'||!identity||!boundary
   ||identity.userId!==initial.scope.expectedAccountId||identity.companyId!==initial.scope.companyId)return false;
  const live=session.liveSnapshot();
  return live.ready&&live.userId===initial.scope.expectedAccountId&&live.boundaryFingerprint===boundary&&session.isCurrentUser(initial.scope.expectedAccountId,identity);
 },[session,identity,boundary,initial,expired]);
 useEffect(()=>{const remaining=Date.parse(initial.expiresAt)-Date.now();if(remaining<=0)return;const timer=setTimeout(()=>setExpired(true),Math.min(remaining,2147483647));return()=>clearTimeout(timer);},[initial.expiresAt]);
 const t=(arabic:string,english:string)=>ar?arabic:english;
 if(!isCurrent())return <main dir={ar?'rtl':'ltr'} className={styles.page} role="status">{session?.status==='loading'?t('جارٍ التحقق من جلسة الاختبار…','Checking test session…'):t('مساحة الاختبار غير متاحة لهذه الجلسة أو انتهى تصريحها.','The test workspace is unavailable for this session or its authorization expired.')} <a href="/setup">{t('العودة إلى التجهيز','Back to Setup')}</a></main>;
 const scope={...initial.scope,boundaryFingerprint:`${boundary}:${initial.authorityFingerprint}`};
 async function inspect(){
  if(busy||!isCurrent())return;
  setBusy(true);
  try{const result=await inspectOwnedSetupMetaTestAction(initial.scope);if(isCurrent())setInspection(result);}
  catch{if(isCurrent())setInspection({status:'unknown',code:'META_UNAVAILABLE'});}
  finally{if(isCurrent())setBusy(false);}
 }
 return <main ref={root} dir={ar?'rtl':'ltr'} data-service-theme="" className={styles.paidShell} data-setup-meta-test data-paid-setup-root>
  <section className={styles.page}>
   <header className="grid gap-3">
    <a href={`/setup?branch=${encodeURIComponent(initial.scope.branchId)}`} onClick={event=>{if(!isCurrent()||!confirmSetupLeave(root.current,locale))event.preventDefault();}}>{t('العودة إلى التجهيز التجاري','Back to commercial Setup')}</a>
    <h1 className="text-2xl font-bold">{t('اختبار التجهيز والمساعد','Setup and assistant test')} · {companyName}</h1>
    <p role="note" className="rounded-xl border border-[var(--service-line)] bg-[var(--service-subtle)] p-4">{t('وضع اختبار محدود. الإعدادات التي تحفظها هنا هي إعدادات فرعك الفعلية. تجربة AI تستخدم المحرك الحقيقي وحصة تجارب التجهيز، ولا تعني نجاح ربط واتساب التجاري أو بدء مدة الاشتراك.','Limited test mode. Settings saved here are your real branch settings. The AI trial uses the real engine and Setup trial allowance; it does not establish a commercial WhatsApp connection or start the subscription period.')}</p>
    <p>{t('ينتهي الاختبار: ','Test expires: ')}{new Date(initial.expiresAt).toLocaleString(ar?'ar-OM':'en-GB',{timeZone:'Asia/Muscat'})}</p>
   </header>
   <nav aria-label={t('خطوات اختبار التجهيز','Setup test steps')} className="my-5 flex flex-wrap gap-2">
    {steps.map(([id,arabic,english])=><button key={id} type="button" aria-current={step===id?'step':undefined} className={`rounded-xl border border-[var(--service-line)] px-4 py-2 text-[var(--service-ink)] ${step===id?'bg-[var(--service-subtle)]':''}`} onClick={()=>{if(isCurrent()&&(id===step||confirmSetupLeave(root.current,locale)))setStep(id);}}>{t(arabic,english)}</button>)}
   </nav>
   {step==='whatsapp'?<section className="grid gap-4">
    <h2>{t('اتصال رقم Meta التجريبي','Meta test-number connection')}</h2>
    <p>{t('هذا فحص قراءة فقط للأصل التجريبي الموجود. لا ينشئ محاولة ربط أو يغيّر أصول واتساب المحفوظة.','This only inspects the existing test asset. It does not start signup or change saved WhatsApp assets.')}</p>
    <button type="button" disabled={busy} onClick={()=>void inspect()} className="rounded-xl bg-[var(--service-accent)] px-5 py-3 text-white">{busy?t('جارٍ التحقق…','Checking…'):t('التحقق من رقم Meta','Check Meta test number')}</button>
    <p role="status">{inspection?.status==='verified_test_asset'?`${t('تم التحقق من الأصل التجريبي فقط: ','Test asset verified only: ')}${inspection.displayNumber}`:`UNKNOWN${inspection?.status==='unknown'?` · ${inspection.code}`:''}`}</p>
    <p>{t('اختبار Gemini متاح داخل خطوة تجربة المساعد. استقبال واتساب والرد الآلي عليه يحتاجان اختبار نقل منفصل؛ لا نعتبرهما ناجحين من هذا الفحص.','Gemini testing is available in Assistant trial. WhatsApp reception and automated replies require separate transport acceptance; this inspection does not establish them.')}</p>
   </section>:step==='launch'?<section role="status"><h2>{t('التشغيل التجاري مستقل عن الاختبار','Commercial launch is separate from testing')}</h2><p>{t('التشغيل يحتاج ربطًا تجاريًا مثبتًا واستيفاء شروط الجاهزية المعتادة. لا يوجد تفعيل أو بدء اشتراك من مساحة الاختبار.','Launch requires a proven commercial connection and the usual readiness conditions. This test workspace cannot activate the business or start a subscription.')}</p></section>:
    <PaidSetupStepHost key={`${step}:${scope.boundaryFingerprint}`} locale={locale} scope={scope} step={step} isCurrent={isCurrent} read={initial.read}/>
   }
  </section>
 </main>;
}

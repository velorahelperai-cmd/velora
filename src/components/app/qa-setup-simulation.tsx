'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useOptionalAccountSession} from './account-chrome';
import styles from './setup-order-review.module.css';

const steps=['نتيجة الدفع التجريبية','أوقات العمل','المعرفة','اللغة ونبرة الرد','القنوات','الفريق','مراجعة التجهيز'];
/** In-memory QA only. No financial, provider, company or setup actions are imported. */
export function QaSetupSimulation({accountId}:{accountId:string}){
 const session=useOptionalAccountSession();
 const [step,setStep]=useState(0),[hours,setHours]=useState('09:00–17:00'),[knowledge,setKnowledge]=useState(''),[language,setLanguage]=useState('ar'),[member,setMember]=useState('QA Member');
 if(session?.status!=='ready'||session.identity?.userId!==accountId)return <p role="status">يلزم حساب الاختبار المصرّح به.</p>;
 return <main data-service-theme="" dir="rtl" className="mx-auto max-w-3xl space-y-6 p-6" data-qa-setup-simulation>
  <h1>VELORA QA — محاكاة داخلية معزولة</h1>
  <p role="note">هذه محاكاة للواجهة فقط. لا يوجد دفع أو شركة أو اشتراك مدفوع. التغييرات في ذاكرة هذه الصفحة وتختفي عند إغلاقها. لا تثبت نجاح Thawani أو Meta أو AI أو إرسال الدعوات.</p>
  <nav aria-label="خطوات المحاكاة" className="flex flex-wrap gap-2">{steps.map((title,index)=><button key={title} type="button" aria-current={step===index?'step':undefined} onClick={()=>setStep(index)}>{index+1}. {title}</button>)}</nav>
  <section className="space-y-4" aria-labelledby="qa-step-title"><h2 id="qa-step-title">{steps[step]}</h2>
   {step===0&&<p role="status">تم اختيار سيناريو نجاح دفع تجريبي محلي. لم تُنشأ دفعة أو حقوق مالية على الخادم.</p>}
   {step===1&&<label>أوقات العمل التجريبية<input className="block border p-2" value={hours} onChange={e=>setHours(e.target.value)}/></label>}
   {step===2&&<label>معرفة تجريبية<textarea className="block w-full border p-2" value={knowledge} maxLength={2000} onChange={e=>setKnowledge(e.target.value)} placeholder="أضف نصًا وهميًا فقط"/></label>}
   {step===3&&<label>لغة الرد التجريبية<select className="block border p-2" value={language} onChange={e=>setLanguage(e.target.value)}><option value="ar">العربية</option><option value="en">الإنجليزية</option></select></label>}
   {step===4&&<p>Meta وWhatsApp غير متصلين. الربط والإرسال معطّلان في المحاكاة.</p>}
   {step===5&&<><label>اسم عضو تجريبي<input className="block border p-2" value={member} onChange={e=>setMember(e.target.value)} maxLength={120}/></label><p>لن تُرسل دعوة ولن تُمنح صلاحيات حقيقية.</p></>}
   {step===6&&<><dl><dt>الساعات</dt><dd>{hours}</dd><dt>المعرفة</dt><dd>{knowledge||'لم تُضف'}</dd><dt>اللغة</dt><dd>{language==='ar'?'العربية':'الإنجليزية'}</dd><dt>العضو التجريبي</dt><dd>{member}</dd></dl><p role="status">انتهت مراجعة المحاكاة. التشغيل الحقيقي والتفعيل والاسترداد: UNKNOWN.</p></>}
  </section>
  <div className="flex flex-wrap gap-3">{step>0&&<button type="button" className={styles.secondary} onClick={()=>setStep(n=>n-1)}>السابق</button>}{step<steps.length-1&&<button type="button" className={styles.primary} onClick={()=>setStep(n=>n+1)}>التالي في المحاكاة</button>}<Link href="/setup" className={styles.secondary}>العودة للتجهيز</Link></div>
 </main>;
}

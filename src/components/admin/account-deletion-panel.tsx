'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import styles from './account-deletion-panel.module.css';
import {accountDeletionAction,advanceAccountDeletion} from '@/lib/account-deletion/actions';
import type {DeletionCategory,DeletionReceipt,DeletionResponse} from '@/lib/account-deletion/types';

const categories:{id:DeletionCategory;label:string}[]=[{id:'delete',label:'سيُحذف'},{id:'shared',label:'مشترك وسيبقى'},{id:'protected',label:'محمي ومحتفظ به'},{id:'blocker',label:'مانع يحتاج قرارًا'}];
const reasons:Record<string,string>={EXCLUSIVE_ELIGIBLE:'بيانات حصرية مؤهلة للحذف.',OTHER_ACCOUNT:'بيانات حساب آخر؛ ستبقى.',OTHER_MEMBER:'عضوية شخص آخر؛ ستبقى.',SHARED_BUSINESS:'بيانات شركة مشتركة؛ ستبقى.',EXCLUSIVE_OWNERSHIP_UNPROVEN:'لم تثبت ملكية حصرية لهذه البيانات.',OTHER_ACCOUNT_DEPENDENCY:'توجد علاقة ببيانات شخص آخر تحتاج معالجة.',RETENTION_DEPENDENCY:'سجل مالي أو تدقيق أو احتفاظ مستثنى من الحذف.',UNCLASSIFIED_RELATION:'لم تعتمد سياسة لهذه العلاقة بعد؛ لن تُحذف تلقائيًا.',PLATFORM_ROLE_REQUIRES_REVIEW:'صلاحية منصة تحتاج قرارًا منفصلًا لمعالجتها.',SHARED_AUTH_DEPENDENCY_REQUIRES_REVIEW:'بيانات مشتركة تعتمد على الهوية؛ يلزم قرار قبل حذفها.',SHARED_OWNERSHIP_TRANSFER_REQUIRED:'الشركة مشتركة؛ يجب معالجة ملكيتها قبل حذف الحساب.',MANAGED_AUTH_API:'هوية أو جلسة تُحذف عبر واجهة Auth المدعومة.',EXCLUSIVE_STORAGE_API:'ملف حصري يُحذف عبر واجهة Storage المدعومة.',STORAGE_OWNERSHIP_UNPROVEN:'لم تثبت حصرية الملف؛ لن يُحذف.',UNREVIEWED_AUTH_DEPENDENCY_SCHEMA:'علاقة مع بيانات Auth خارج النطاق المدعوم تحتاج مراجعة.'};
const stages:Record<string,string>={STORAGE:'الملفات',DATABASE:'البيانات',AUTH:'هوية الحساب وجلساته',VERIFY:'التحقق النهائي'};
const phaseErrors:Record<string,string>={EFFECT_UNCONFIRMED:'تعذر حسم أثر المرحلة؛ ستُفحص النتيجة قبل أي تكرار.',PROVIDER_REJECTED:'رفض المزود الطلب؛ لم تُسجل المرحلة كنجاح.',SCOPE_CHANGED:'تغيّر نطاق البيانات؛ توقف التنفيذ للمراجعة.',PROTECTED_RELATION_REQUIRES_REVIEW:'علاقة محمية منعت معاملة قاعدة البيانات؛ لم تُكسر الحماية.',WORKER_LEASE_EXPIRED:'انتهى حجز المحاولة السابقة؛ الاستئناف يبدأ بفحص أثرها.'};
const errors:Record<string,string>={FORBIDDEN:'لا توجد صلاحية أو انتهت الجلسة.',PROTECTED_OWNER:'مالك منصة محمي بالمعرّف؛ لا يمكن حذفه.',PROTECTED_DEPENDENCY:'علاقات محمية أو غير مصنفة تمنع التنفيذ. يلزم قرار محدد للعلاقة، دون تغيير الحماية تلقائيًا.',SCOPE_CHANGED:'تغيّر النطاق؛ راجع الفرق وجدّد التأكيد.',PREVIEW_EXPIRED:'انتهت المعاينة؛ جدّدها دون تغيير اعتماد التصميم.',SCHEMA_CHANGED_REVIEW_REQUIRED:'تغيّر مخطط البيانات؛ يلزم فحص العلاقات المتغيرة.',UNAVAILABLE:'تعذر حسم النتيجة. افحص الحالة قبل المحاولة مجددًا.'};
const stateLabels:Record<string,string>={PENDING:'في الانتظار',RUNNING:'قيد التنفيذ',SUCCEEDED:'اكتملت',FAILED:'تعثرت',UNKNOWN:'تحتاج مصالحة'};
const relationLabels:Record<string,string>={'public.profiles':'الملف الشخصي','public.companies':'الشركات','public.company_members':'عضويات الشركات','public.company_branches':'الفروع','public.account_prep_drafts':'مسودات الحساب','public.company_setup_drafts':'مسودات التجهيز','public.knowledge_sources':'مصادر المعرفة','public.admin_audit_logs':'سجل تدقيق الإدارة','private.g03_company_inputs':'مدخلات مراجعة الشركة','storage.objects':'الملفات المرفوعة','auth.users':'هوية الحساب','auth.sessions':'الجلسات','auth.identities':'طرق تسجيل الدخول','private.app_session_activity':'نشاط الجلسات'};
function ShieldIcon(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3 4.5 6v5c0 4.5 3 8 7.5 10 4.5-2 7.5-5.5 7.5-10V6L12 3Z"/><path d="m8.5 12 2.3 2.3 4.7-4.8"/></svg>;}
function TrashIcon(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg>;}

export function AccountDeletionPanel({target,email}:{target:string;email:string|null}){
 const [open,setOpen]=useState(false),[receipt,setReceipt]=useState<DeletionReceipt|null>(null),[confirmation,setConfirmation]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[diff,setDiff]=useState<NonNullable<Extract<DeletionResponse,{ok:true}>['diff']>>([]);
 const pending=useRef(false),requestId=useRef<string|null>(null),panelRef=useRef<HTMLElement|null>(null),closeRef=useRef<HTMLButtonElement|null>(null);
 const titleId=useId();
 useEffect(()=>{
  if(!open)return;
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';panelRef.current?.focus();if(!closeRef.current?.disabled)closeRef.current?.focus();
  const keyboard=(e:KeyboardEvent)=>{
   if(e.key==='Escape'&&!pending.current){setOpen(false);setConfirmation('');}
   if(e.key==='Tab'){
    const controls=Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')??[]).filter(el=>!el.closest('details:not([open])')||el.tagName==='SUMMARY');
    const first=controls[0],last=controls.at(-1);
    if(document.activeElement===panelRef.current||!panelRef.current?.contains(document.activeElement)){e.preventDefault();(e.shiftKey?last:first)?.focus();}
    else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
   }
  };
  document.addEventListener('keydown',keyboard);
  return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keyboard);previous?.focus();};
 },[open]);
 async function request(action:'preview'|'lookup'|'status'|'renew'|'start'|'classify'|'advance',isTest?:boolean){
  if(pending.current)return;pending.current=true;setBusy(true);setMessage('');
  try{
   if(!requestId.current)requestId.current=crypto.randomUUID();
   const res=action==='advance'&&receipt?await advanceAccountDeletion(receipt.id):await accountDeletionAction(action==='advance'?'lookup':action,{target,requestId:requestId.current,...(receipt?{id:receipt.id,fingerprint:receipt.fingerprint}:{}),...(isTest===undefined?{}:{isTest})});
   if(!res.ok){setMessage(errors[res.code]??'تعذر تنفيذ الإجراء. افحص الحالة أو جدّد الجلسة.');return;}
   if(res.data)setReceipt(res.data);
   if(res.diff)setDiff(res.diff);
   if(res.code)setMessage(errors[res.code]??(res.code==='RENEWED'?'تم تجديد المعاينة على الخادم.':res.code));
   if(action==='start'||action==='renew'||action==='classify')setConfirmation('');
   if(action==='classify')setMessage('حُفظ تصنيف الحساب وسُجّل تغييره. جدّد المعاينة قبل التأكيد.');
   if(action==='lookup'&&!res.data)setMessage('لا توجد عملية محفوظة لهذا الحساب. يمكنك طلب معاينة.');
  }catch{setMessage(errors.UNAVAILABLE);}finally{pending.current=false;setBusy(false);}
 }
 const blocked=receipt?.items.some(x=>x.category==='blocker'||x.blocks);
 return <>
  <button type="button" className={styles.trigger} disabled={busy} aria-expanded={open} aria-haspopup="dialog" onClick={()=>{setOpen(true);void request('preview');}}><TrashIcon/>معاينة حذف الحساب</button>
  {open&&createPortal(<div className={styles.overlay} dir="rtl">
   <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-label="حذف الحساب" className={styles.panel}>
    <header className={styles.header}>
     <span className={styles.mark}><TrashIcon/></span>
     <div><h2 id={titleId}>حذف الحساب</h2><p className={styles.subtitle}>راجع النطاق أولًا، ثم أكّد حذف البيانات المؤهلة فقط.</p></div>
     <button ref={closeRef} type="button" className={styles.close} disabled={busy} onClick={()=>{setOpen(false);setConfirmation('');}}>إغلاق</button>
    </header>
    <div className={styles.body}>
     <div className={styles.identity}>
      <div className={styles.identityTop}><p className={styles.email} dir="ltr">{email??'بريد غير متاح'}</p><span className={`${styles.badge} ${receipt?.isTest?styles.testBadge:''}`}>{receipt?(receipt.isTest?'حساب اختبار':'حساب عميل'):'بانتظار المعاينة'}</span></div>
      <div className={styles.idRow}><span>معرّف الحساب الثابت</span><code dir="ltr">{target}</code></div>
     </div>
     <div className={styles.tools}><p className={styles.description}>{receipt?.completedAt?'اكتملت العملية؛ الإيصال محفوظ.':receipt?.fenced?'عملية محفوظة وقابلة للاستئناف.':'لا يبدأ الحذف عند فتح المعاينة.'}</p><button type="button" className={styles.linkButton} disabled={busy} onClick={()=>void request('lookup')}>فحص الحالة</button></div>
     <p role="status" aria-live="polite" className={styles.notice}>{busy?'جارٍ التحقق من الخادم…':message}</p>
     {receipt&&<>
      {receipt.completedAt&&<div role="status" className={`${styles.notice} ${styles.success}`}><strong>اكتمل حذف النطاق المسموح والتحقق منه.</strong>البيانات المستثناة المعروضة باقية. حاجز الحساب مستمر لمنع إعادة إنشاء بياناته.</div>}
      <div><h3 className={styles.sectionTitle}>{receipt.completedAt?'نطاق العملية':'ما الذي يشمله هذا الإجراء؟'}</h3><div className={styles.categoryGrid}>{categories.map(c=><div key={c.id} className={`${styles.category} ${styles[c.id]}`}><strong>{receipt.items.filter(x=>x.category===c.id).length}</strong><span>{c.label}</span></div>)}</div></div>
      {blocked&&!receipt.completedAt&&<div className={`${styles.notice} ${styles.warning}`}><strong>توجد علاقات تمنع التنفيذ</strong>راجع التفاصيل أدناه. البيانات المشتركة والمحمية لن تُحذف تلقائيًا.</div>}
      <div className={styles.groups}>{categories.map(c=>{const items=receipt.items.filter(x=>x.category===c.id);return <details key={c.id} open={items.length>0&&(c.id==='blocker'||c.id==='protected')} className={styles.group}>
       <summary>{c.label}<span className={styles.count}>{items.length}</span></summary>
       {items.length?<ul className={styles.items}>{items.map(x=><li key={x.identity} className={styles.item}><strong>{relationLabels[x.relation]??x.relation}</strong><span>{reasons[x.reason]??'علاقة تحتاج مراجعة محددة.'}{x.blocks?' هذه العلاقة تمنع التنفيذ.':''}</span><code>{x.relation} · {JSON.stringify(x.key)}</code></li>)}</ul>:<p className={styles.empty}>لا توجد عناصر في هذه الفئة ضمن المعاينة.</p>}
      </details>;})}</div>
      {diff.length>0&&<div role="alert" className={`${styles.notice} ${styles.warning}`}><strong>الفرق عن المعاينة السابقة فقط</strong><ul>{diff.map(x=><li key={x.identity} dir="ltr">{x.identity}: {x.before?.category??'added'} → {x.after?.category??'removed'} {x.before?.revision!==x.after?.revision?'(revision changed)':''}</li>)}</ul></div>}
      {!receipt.fenced?<>
       <div className={styles.tools}><span className={styles.description}>{receipt.isTest?'معلّم صراحة كحساب اختبار.':'هذا الحساب غير معلّم كتجربة.'} تغييرات التصنيف تُسجّل باسم المالك.</span><button type="button" className={styles.linkButton} disabled={busy} onClick={()=>void request('classify',!receipt.isTest)}>{receipt.isTest?'إزالة علامة الاختبار':'تعيين حساب اختبار'}</button></div>
       <div className={styles.confirmation}>
        <div><h3>تأكيد الحذف النهائي</h3><p className={styles.description}>لن يمكن التراجع عن حذف البيانات المؤهلة. طابق المعرّف مع الحساب أعلاه قبل التأكيد.</p></div>
        <label className={styles.label}>اكتب معرّف الحساب للتأكيد<input aria-label="اكتب معرّف الحساب للتأكيد" className={styles.input} dir="ltr" placeholder="UUID" value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off" spellCheck={false}/></label>
        <p className={styles.description}>المعاينة صالحة حتى <time dir="ltr">{receipt.expiresAt}</time> بحسب الخادم.</p>
        <div className={styles.confirmActions}><button type="button" className={styles.linkButton} disabled={busy} onClick={()=>void request('renew')}>تجديد المعاينة</button><button type="button" className={styles.danger} disabled={busy||blocked||confirmation!==target} onClick={()=>void request('start')}>تأكيد الحذف النهائي للنطاق المعروض</button></div>
       </div>
      </>:<div>
       <h3 className={styles.sectionTitle}>مراحل التنفيذ</h3>
       <ol className={styles.steps}>{Object.keys(stages).map((stage,i)=><li key={stage} className={styles.step} data-state={receipt.states[stage]??'UNKNOWN'}><span className={styles.stepNumber}>{receipt.states[stage]==='SUCCEEDED'?'✓':i+1}</span><strong>{stages[stage]}</strong><span>{stateLabels[receipt.states[stage]??'UNKNOWN']??'تحتاج مراجعة'}</span></li>)}</ol>
       {!receipt.completedAt&&<><p className={styles.description}>الحساب محجوز للحذف؛ يبقى الحاجز أثناء التعثر والاستئناف.</p><button type="button" className={styles.button} disabled={busy} onClick={()=>void request('advance')}>استئناف المرحلة التالية / مصالحة النتيجة</button></>}
      </div>}
      {receipt.error&&<p role="alert" className={`${styles.notice} ${styles.warning}`}>{phaseErrors[receipt.error]??'توقفت المرحلة؛ افحص حالتها قبل الاستئناف.'} <span dir="ltr">({receipt.error})</span></p>}
      <details className={styles.receipt}><summary>تفاصيل الإيصال المحفوظ</summary><dl><dt>معرّف العملية</dt><dd>{receipt.id}</dd><dt>طالب الحذف</dt><dd>{receipt.actor}</dd><dt>الوقت UTC</dt><dd>{receipt.createdAt}</dd></dl><p className={styles.description}>يُحتفظ بإيصال العملية وسجل مراحلها المنقّح للتدقيق، دون محتوى البيانات المحذوفة.</p></details>
     </>}
    </div>
    <footer className={styles.footer}><ShieldIcon/><div><p>الحذف يشمل البيانات النشطة المؤهلة فقط؛ السجلات المستثناة والمشتركة تبقى محفوظة.</p><p>لا تختفي النسخ الاحتياطية فورًا. المصالحة عند الاستعادة متطلب منفصل لم تُختبر آليته هنا، ولنسخ المزودين إجراءات مستقلة.</p></div></footer>
   </section>
  </div>,document.body)}
 </>;
}

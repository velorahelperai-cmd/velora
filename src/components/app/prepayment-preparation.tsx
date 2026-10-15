'use client';
import {useId,useRef,useState} from 'react';
import Link from 'next/link';
import {AccountMenu,useOptionalAccountSession} from './account-chrome';
import {LangSwitch} from './ui';
import {useDemo} from '@/lib/demo-state';
import {emptyPreparation,validatePreparation,type Preparation} from '@/lib/tenancy/prepayment-preparation';
import {BusinessNameSuggestions} from './business-name-suggestions';
import {BusinessTypeCombobox} from './business-type-combobox';
import {CountryCombobox} from './country-combobox';
import {BusinessPhoneField} from './business-phone-field';
import {businessTypeLabel} from '@/lib/business-types';
import {businessNameSuggestions,rememberBusinessName,forgetBusinessNames} from '@/lib/field-suggestions';
import {recordPreparationValidationRejected} from '@/lib/logging/browser.mjs';
import {setupSubscriptionReturn} from '@/lib/auth/setup-return';
import styles from './setup-entry.module.css';
import pageStyles from './prepayment-preparation.module.css';

/** The authenticated actor is a mount boundary; no draft/server state enters. */
export function PrepaymentPreparation({userId,preferredNext=''}:{userId:string;preferredNext?:string}){
 const session=useOptionalAccountSession(),{locale}=useDemo();
 if(session?.status!=='ready'||session.identity?.userId!==userId)return <p role="status">{locale==='ar'?'جارٍ تأكيد الحساب…':'Confirming your account…'}</p>;
 const identity=session.identity;
 // Navigation intent only: query amounts never establish a trusted quote.
 return <main data-service-theme="" className={pageStyles.page} dir={locale==='ar'?'rtl':'ltr'} data-plan-intent={preferredNext?setupSubscriptionReturn(preferredNext):undefined}><header className={pageStyles.header}><Link href="/">Velora</Link><div><LangSwitch/><AccountMenu compact/></div></header><PreparationForm key={userId} ar={locale==='ar'} userId={userId} isCurrent={()=>session.isCurrentUser(userId,identity)}/></main>;
}
export function PreparationForm({ar,userId,isCurrent}:{ar:boolean;userId:string;isCurrent:()=>boolean}){
 const id=useId(),form=useRef<HTMLDivElement>(null),[value,setValue]=useState(emptyPreparation),[review,setReview]=useState(false),[errors,setErrors]=useState<string[]>([]),[suggestionStatus,setSuggestionStatus]=useState('');
 const t=(a:string,e:string)=>ar?a:e;
 function change(key:Exclude<keyof Preparation,'branches'>,next:string){if(isCurrent()){setValue(old=>({...old,[key]:next}));setErrors([]);}}
 function branch(index:number,key:'name'|'city',next:string){if(isCurrent())setValue(old=>({...old,branches:old.branches.map((row,i)=>i===index?{...row,[key]:next}:row)}));}
 function submit(){if(!isCurrent()||review)return;const rejected=validatePreparation(value);if(form.current?.querySelector('input:invalid'))rejected.push('input');setErrors(rejected);if(rejected.length)recordPreparationValidationRejected({userId});else setReview(true);}
 function suggestion(remove:boolean){if(!isCurrent())return;try{const store=window.localStorage;if(remove)forgetBusinessNames(store,userId);else rememberBusinessName(store,userId,value.name);const names=businessNameSuggestions(store,userId);const ok=remove?names.length===0:names.includes(value.name.trim());setSuggestionStatus(ok?t(remove?'حُذفت اقتراحات الاسم لهذا الحساب.':'حُفظ الاسم كاقتراح محلي فقط.',remove?'Name suggestions removed for this account.':'Name saved as a local suggestion only.'):t('تعذّر تحديث الاقتراحات المحلية.','Local suggestions could not be updated.'));}catch{setSuggestionStatus(t('التخزين المحلي غير متاح.','Local storage is unavailable.'));}}
 const labels={name:t('اسم النشاط','Business name'),city:t('مدينة النشاط','Business city'),type:t('نوع النشاط','Business type'),country:t('الدولة','Country'),phone:t('هاتف النشاط','Business phone')};
 const input=(key:'name'|'city',label=labels[key])=><div className={styles.field}><label htmlFor={`${id}-${key}`}>{label}</label><input id={`${id}-${key}`} value={value[key]} maxLength={120} required autoComplete="off" onChange={e=>change(key,e.target.value)}/></div>;
 if(!isCurrent())return null;
 return <section className={styles.entry} dir={ar?'rtl':'ltr'} aria-labelledby={`${id}-heading`}>
  <div className={styles.formColumn}><div className={styles.intro}><h2 id={`${id}-heading`}>{t('جهّز نشاطك قبل الدفع','Prepare your business before payment')}</h2><p>{t('البيانات في ذاكرة هذه الصفحة فقط. المغادرة أو إعادة التحميل تبدأ نموذجًا فارغًا. لا يُنشأ نشاط أو فرع قبل تأكيد الدفع.','Details stay in this page memory. Leaving or reloading starts blank. No business or branch is created before verified payment.')}</p></div>
  {review?<div className={styles.form}>
   <h3>{t('مراجعة محلية','Local review')}</h3><dl>{(['name','type','country','city','phone'] as const).map(key=><div key={key}><dt>{labels[key]}</dt><dd>{key==='type'?businessTypeLabel(value[key],ar):value[key]}</dd></div>)}</dl>
   <ol>{value.branches.map((row,index)=><li key={index}>{row.name} — {row.city}</li>)}</ol>
   <p role="status">{t('تم التحقق من اكتمال البيانات محليًا ولم تُرسل. اختيار الباقة والدفع غير متاحين حاليًا.','Details checked locally and have not been sent. Plan selection and payment are currently unavailable.')}</p>
   <button type="button" className={styles.submit} onClick={()=>{if(isCurrent())setReview(false);}}>{t('تعديل البيانات','Edit details')}</button>
  </div>:<div ref={form} role="form" aria-label={t('بيانات التجهيز المحلية','Local preparation details')} className={styles.form}>
   <div className={styles.field}><label htmlFor={`${id}-name`}>{labels.name}</label><BusinessNameSuggestions id={`${id}-name`} value={value.name} ar={ar} userId={userId} isCurrent={isCurrent} onChange={next=>change('name',next)}/></div>
   <div className={styles.fieldRow}><button type="button" disabled={!value.name.trim()} onClick={()=>suggestion(false)}>{t('تذكّر الاسم كاقتراح محلي','Remember name as a local suggestion')}</button><button type="button" onClick={()=>suggestion(true)}>{t('حذف اقتراحات الاسم لهذا الحساب','Delete name suggestions for this account')}</button></div>
   {suggestionStatus?<p role="status">{suggestionStatus}</p>:null}
   <div className={styles.field}><label htmlFor={`${id}-type`}>{labels.type}</label><BusinessTypeCombobox id={`${id}-type`} value={value.type} ar={ar} onChange={next=>change('type',next)}/></div>
   <div className={styles.field}><label htmlFor={`${id}-country`}>{labels.country}</label><CountryCombobox id={`${id}-country`} value={value.country} ar={ar} disabled={false} onChange={next=>change('country',next)}/></div>
   {input('city')}
   <BusinessPhoneField id={`${id}-phone`} label={labels.phone} value={value.phone} businessCountry={value.country} ar={ar} isCurrent={isCurrent} onChange={next=>change('phone',next)}/>
   <h3>{t('الفروع','Branches')}</h3>
   {value.branches.map((row,index)=><fieldset key={index} className={styles.form}><legend>{t('الفرع','Branch')} {index+1}</legend>{(['name','city'] as const).map(key=><div className={styles.field} key={key}><label htmlFor={`${id}-branch-${index}-${key}`}>{key==='name'?t('اسم الفرع','Branch name'):t('مدينة الفرع','Branch city')}</label><input id={`${id}-branch-${index}-${key}`} value={row[key]} maxLength={120} required autoComplete="off" onChange={e=>branch(index,key,e.target.value)}/></div>)}<button type="button" disabled={value.branches.length===1} onClick={()=>{if(isCurrent())setValue(old=>({...old,branches:old.branches.length>1?old.branches.filter((_,i)=>i!==index):old.branches}));}}>{t('إزالة الفرع','Remove branch')}</button></fieldset>)}
   <button type="button" onClick={()=>{if(isCurrent())setValue(old=>({...old,branches:[...old.branches,{name:'',city:''}]}));}}>{t('إضافة فرع','Add branch')}</button>
   {errors.length?<p className={styles.error} role="alert">{t('راجع الحقول المطلوبة وصحة الهاتف، وتأكد من عدم تكرار اسم الفرع ومدينته.','Check required fields and the phone number; branch name and city pairs must be unique.')}</p>:null}
   <button type="button" onClick={submit} className={styles.submit}>{t('مراجعة البيانات محليًا','Review details locally')}</button>
  </div>}</div>
  <aside className={styles.guide}><h3>{t('قبل المتابعة','Before continuing')}</h3><p>{t('مراجعة هذه البيانات لا تحفظها على السيرفر ولا تثبت الدفع أو تفعّل الخدمة.','Review does not save these details to the server, prove payment or activate service.')}</p></aside>
 </section>;
}

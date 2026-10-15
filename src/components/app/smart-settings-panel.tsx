'use client';
import {useEffect,useRef,useState,useId} from 'react';
import {useRouter} from 'next/navigation';
import {readSmartCompanySettings,saveSmartCompanySettings,type SmartCompanySettings} from '@/lib/tenancy/smart-onboarding-actions';
import {validSmartProfileDraft} from './smart-settings-validation';
import type {Business} from '@/lib/demo-state';
import type {CompanyRecord} from '@/lib/tenancy/types';
import {useSmartAccountGuard,useSmartAutosave} from './use-smart-autosave';
import {SmartAutosaveStatus} from './smart-autosave-status';
import {Button} from './ui';
import styles from './smart-setup.module.css';
import {BusinessTypeCombobox} from './business-type-combobox';
import {BusinessPhoneField} from './business-phone-field';
import {BusinessEmailField} from './business-email-field';
import {CountryCombobox} from './country-combobox';
import {useOptionalAccountSession} from './account-chrome';
import {accountContactEmail} from '@/lib/business-contact-email';
import contactStyles from './business-contact-fields.module.css';
type Props={userId:string;company:CompanyRecord;locale:'ar'|'en';section:'profile'|'hours'|'language';onSaved:(company:CompanyRecord)=>void;onClose:()=>void};
export function SmartSettingsPanel(props:Props){
 return <SettingsRead key={`${props.userId}:${props.company.id}`} {...props}/>;
}
function SettingsRead(props:Props){
 const [record,setRecord]=useState<SmartCompanySettings|null>(null),[error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0);
 const scope=`${props.userId}:${props.company.id}`,current=useSmartAccountGuard(props.userId,props.company.id),ar=props.locale==='ar';
 useEffect(()=>{let live=true;
  const timer=setTimeout(()=>{if(live){live=false;setError('TIMEOUT');}},10000);
  void readSmartCompanySettings({expectedUserId:props.userId,expectedCompanyId:props.company.id}).then(r=>{
   if(!live||!current())return;live=false;clearTimeout(timer);
   if(r.ok){setRecord(r.data);setError(null);}else setError(r.code);
  }).catch(()=>{if(live&&current()){live=false;clearTimeout(timer);setError('UNAVAILABLE');}});
  return()=>{live=false;clearTimeout(timer);};
 },[scope,retry,props.userId,props.company.id,current]);
 if(!record)return <div className={styles.branchForm}>
  <p role={error?'alert':'status'}>{error==='TIMEOUT'?(ar?'استغرق تحميل بيانات نشاطك وقتًا أطول من المتوقع. أعد المحاولة.':'Loading your business details took longer than expected. Retry.'):
   error==='FORBIDDEN'?(ar?'لا تسمح صلاحية حسابك بعرض إعدادات هذا النشاط.':'Your account cannot access this business’s settings.'):
   error?(ar?'تعذّر تحميل بيانات نشاطك المحفوظة. أعد المحاولة.':'Could not load your saved business details. Retry.'):
   (ar?'جارٍ تحميل بيانات نشاطك…':'Loading your business details…')}</p>
  <div>{error?<Button type="button" onClick={()=>{setError(null);setRetry(n=>n+1);}}>{ar?'إعادة المحاولة':'Retry'}</Button>:null}
   <Button type="button" variant="secondary" onClick={props.onClose}>{ar?'العودة للتجهيز':'Return to setup'}</Button></div>
 </div>;
 return <LoadedSettings key={scope} {...props} record={record}/>;
}
function LoadedSettings({userId,company,locale,section,onSaved,onClose,record}:Props&{record:SmartCompanySettings}){
 const typeId=useId(),session=useOptionalAccountSession();
 const [emailDismissed,setEmailDismissed]=useState(false),[contactReset,setContactReset]=useState(0);
 const ar=locale==='ar',router=useRouter(),current=useSmartAccountGuard(userId,company.id);const [reloadError,setReloadError]=useState<string|null>(null),receipt=useRef<SmartCompanySettings|null>(null);
 const autosave=useSmartAutosave({scope:`${userId}:${company.id}:profile`,value:record.profile,revision:record.revision,digest:record.profileDigest,validate:validSmartProfileDraft,current,
  save:async a=>{const r=await saveSmartCompanySettings({expectedUserId:userId,expectedCompanyId:company.id,attemptId:a.id,expectedRevision:a.revision,expectedProfileDigest:a.digest,profile:a.value});if(r.ok)receipt.current=r.data;return r.ok?{ok:true,data:{value:r.data.profile,revision:r.data.revision,digest:r.data.profileDigest}}:r;},
  committed:r=>{const p=r.value;onSaved({...company,display_name:p.name,business_type:p.type,reply_language:p.replyLanguage,country:p.country,city:p.city,hours:p.hours,contact_phone:p.contactPhone,contact_email:p.contactEmail,...(receipt.current?.companyVersion?{version:receipt.current.companyVersion}:{}),...(receipt.current?.updatedAt?{updated_at:receipt.current.updatedAt}:{})});router.refresh();}});
 const state=autosave.state;
 async function reload(){if(!current()||!window.confirm(ar?'استبدال تعديلاتك بالبيانات المحفوظة الحالية؟':'Replace your edits with the latest saved settings?'))return;const r=await readSmartCompanySettings({expectedUserId:userId,expectedCompanyId:company.id});if(!current())return;if(r.ok){autosave.reload(r.data.profile,r.data.revision,r.data.profileDigest);setReloadError(null);setContactReset(n=>n+1);}else setReloadError(r.code);}
 if(!state)return <p role="status">{ar?'جارٍ استعادة التعديلات…':'Restoring edits…'}</p>;
 const suggestedEmail=accountContactEmail(userId,session?.identity,session?.status==='ready'&&current());
 const emailValue=state.value.contactEmail||(!emailDismissed?suggestedEmail:'');
 // A displayed default never creates a write. Include it only in a deliberate
 // existing settings edit; the immutable autosave attempt then owns its value.
 const set=(key:keyof Business,value:string)=>{if(!current())return;if(key==='contactEmail'&&!value)setEmailDismissed(true);autosave.edit({...state.value,contactEmail:emailValue,[key]:value});};
 const labels:Record<keyof Business,string>={name:ar?'اسم النشاط':'Business name',type:ar?'نوع النشاط':'Business type',country:ar?'الدولة':'Country',city:ar?'المدينة':'City',hours:ar?'ساعات العمل':'Business hours',contactPhone:ar?'هاتف النشاط':'Business phone',contactEmail:ar?'بريد النشاط':'Business email',replyLanguage:ar?'لغة الرد':'Reply language'};
 const keys:Array<keyof Business>=section==='hours'?['hours']:section==='language'?['replyLanguage']:['name','type','country','city','contactPhone','contactEmail'];
 return <form className={`${styles.branchForm} ${contactStyles.profile}`} onSubmit={e=>e.preventDefault()}>
 {keys.map(key=>key==='type'?<div key={key}><label htmlFor={typeId}>{labels[key]}</label><BusinessTypeCombobox id={typeId} value={state.value.type} ar={ar} onChange={value=>set('type',value)}/><p className={contactStyles.hint}>{ar?'النوع يصف خدمتك، ولا يفعّل استشارات متخصصة أو تكاملات إضافية.':'Type describes your service; it does not enable specialist advice or extra integrations.'}</p></div>:
  key==='contactPhone'?<BusinessPhoneField key={`${key}:${contactReset}`} id={`${typeId}-phone`} label={labels[key]} value={state.value.contactPhone} businessCountry={state.value.country} ar={ar} isCurrent={current} onChange={value=>set('contactPhone',value)}/>:
  key==='contactEmail'?<BusinessEmailField key={`${key}:${contactReset}`} id={`${typeId}-email`} label={labels[key]} value={emailValue} suggestedEmail={suggestedEmail} ar={ar} isCurrent={current} onChange={value=>set('contactEmail',value)}/>:
  key==='country'?<div key={key}><label htmlFor={`${typeId}-country`}>{labels[key]}</label><CountryCombobox id={`${typeId}-country`} value={state.value.country} ar={ar} disabled={!current()} onChange={value=>set('country',value)}/></div>:
  <label key={key}>{labels[key]}{key==='replyLanguage'?<select value={state.value[key]} onChange={e=>set(key,e.target.value)}><option value="ar">{ar?'العربية':'Arabic'}</option><option value="en">{ar?'الإنجليزية':'English'}</option><option value="both">{ar?'العربية والإنجليزية':'Arabic and English'}</option></select>:<input value={state.value[key]} type="text" placeholder={key==='name'?(ar?'مثل: كراميلا برجر':'For example, Caramella Burger'):key==='city'?(ar?'المدينة التي يعمل بها نشاطك':'City where your business operates'):(ar?'مثل: الأحد–الخميس، 9 صباحًا–6 مساءً':'For example, Sun–Thu, 9 am–6 pm')} maxLength={key==='name'?120:key==='city'?160:2000} required={key==='name'} onChange={e=>set(key,e.target.value)}/>}</label>)}
 <SmartAutosaveStatus ar={ar} status={state.status} code={state.code} onRetry={()=>void autosave.retry()} onReload={()=>void reload()}/>
 {reloadError?<p role="alert">{ar?'تعذر قراءة أحدث البيانات. احتفظنا بتعديلاتك.':'Could not read latest settings. Your edits were kept.'}</p>:null}
 <Button type="button" variant="secondary" onClick={onClose}>{ar?'العودة للتجهيز':'Return to setup'}</Button>
 </form>;
}

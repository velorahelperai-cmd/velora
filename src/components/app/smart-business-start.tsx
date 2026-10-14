'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {createSmartBusiness} from '@/lib/tenancy/smart-business-start-actions';
import type {CompanyRecord} from '@/lib/tenancy/types';
import {parseSmartStartStorage,type SmartStartFields,type SmartStartAttempt} from '@/lib/tenancy/smart-business-start-storage';
import {useOptionalAccountSession} from './account-chrome';
import {Button,Field,Notice} from './ui';

type Fields=SmartStartFields;
type Attempt=SmartStartAttempt;
export function SmartBusinessStart({userId,ar,onCreated}:{userId:string;ar:boolean;onCreated:(company:CompanyRecord)=>void}){
  const session=useOptionalAccountSession(),router=useRouter(),key=`velora_smart_first_business:${userId}`;
  const [fields,setFields]=useState<Fields>({name:'',type:'other',country:'OM'});
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[pending,setPending]=useState(false);
  const operation=useRef<Attempt|null>(null),mounted=useRef(true),inFlight=useRef(false);
  const current=()=>mounted.current&&(!session||session.isCurrentUser(userId));
  const ready=!session||session.status==='ready'&&session.identity?.userId===userId;
  const notices:Record<string,[string,string]>={
    LOCAL_STORAGE_UNAVAILABLE:['تعذّر حفظ الطلب في هذا المتصفح. اسمح بالتخزين ثم حاول مجددًا.','This browser could not save the request. Allow storage, then try again.'],
    LOCAL_RECOVERY_INVALID:['تعذّر قراءة طلب الإنشاء المحفوظ. أعد تحميل الصفحة قبل المتابعة.','The saved creation request could not be read. Reload before continuing.'],
    INVALID_INPUT:['راجع اسم النشاط ونوعه والدولة ثم حاول مجددًا.','Check the business name, type and country, then try again.'],
    PHONE_REQUIRED:['يلزم تأكيد هاتف حسابك قبل إنشاء النشاط.','Verify your account phone before creating a business.'],
    UNAUTHENTICATED:['سجّل الدخول مجددًا لاستكمال تجهيز نشاطك.','Sign in again to continue setting up your business.'],
    FORBIDDEN:['حسابك لا يملك صلاحية إنشاء هذا النشاط.','Your account cannot create this business.'],
    UNCONFIGURED:['إنشاء النشاط غير متاح حاليًا. حاول لاحقًا.','Business creation is currently unavailable. Try again later.'],
  };
  useEffect(()=>{mounted.current=true;const frame=requestAnimationFrame(()=>{try{const raw=localStorage.getItem(key);if(!raw)return;const saved=parseSmartStartStorage(JSON.parse(raw),userId);if(!saved){setError('LOCAL_RECOVERY_INVALID');return;}setFields(saved.fields);if(saved.attempt){operation.current=saved.attempt;setPending(true);}}catch{setError('LOCAL_STORAGE_UNAVAILABLE');}});return()=>{mounted.current=false;cancelAnimationFrame(frame);};},[key,userId]);
  function change(k:keyof Fields,v:string){if(!current()||pending)return;const next={...fields,[k]:v};setFields(next);try{localStorage.setItem(key,JSON.stringify({userId,fields:next}));}catch{setError('LOCAL_STORAGE_UNAVAILABLE');}}
  async function submit(e:FormEvent){e.preventDefault();if(!ready||!current()||inFlight.current||!fields.name.trim()||!fields.type.trim()||!fields.country.trim())return;
    const previousAttempt=operation.current;
    operation.current??={id:crypto.randomUUID(),fields:{...fields}};const attempt=operation.current;
    try{localStorage.setItem(key,JSON.stringify({userId,fields:attempt.fields,attempt}));}catch{if(!previousAttempt)operation.current=null;setError('LOCAL_STORAGE_UNAVAILABLE');return;}
    inFlight.current=true;setBusy(true);setPending(true);setError(null);
    try{const result=await createSmartBusiness({expectedUserId:userId,attemptId:attempt.id,...attempt.fields});if(!current())return;
      if(!result.ok){
        // These responses prove the request did not commit. Unknown outcomes
        // retain the exact durable attempt for receipt recovery instead.
        if(['INVALID_INPUT','UNCONFIGURED','FORBIDDEN','UNAUTHENTICATED'].includes(result.code)){
          try{localStorage.setItem(key,JSON.stringify({userId,fields:attempt.fields}));operation.current=null;setPending(false);}
          catch{setError('LOCAL_STORAGE_UNAVAILABLE');return;}
        }
        setError(result.code);return;
      }
      try{localStorage.removeItem(key);}catch{/* Native creation is confirmed. */}
      onCreated(result.data);router.refresh();
    }catch{if(current())setError('UNAVAILABLE');}finally{inFlight.current=false;if(current())setBusy(false);}
  }
  return <form onSubmit={submit} className="grid max-w-xl gap-4" noValidate>
    <p>{ar?'ابدأ باسم النشاط ونوعه والدولة. بقية الإعدادات تُحفظ تلقائيًا بعد إنشاء النشاط.':'Start with the business name, type and country. Other settings save automatically after creation.'}</p>
    <Field label={ar?'اسم النشاط':'Business name'} required>{p=><input {...p} value={fields.name} maxLength={120} disabled={pending||!ready} onChange={e=>change('name',e.target.value)}/>}</Field>
    <Field label={ar?'نوع النشاط':'Business type'} required>{p=><select {...p} value={fields.type} disabled={pending||!ready} onChange={e=>change('type',e.target.value)}>{[['other','أخرى','Other'],['retail','متجر','Store'],['restaurant','مطعم','Restaurant'],['clinic','عيادة','Clinic'],['services','خدمات','Services']].map(([id,a,en])=><option key={id} value={id}>{ar?a:en}</option>)}</select>}</Field>
    <Field label={ar?'الدولة':'Country'} required>{p=><input {...p} value={fields.country} maxLength={80} disabled={pending||!ready} onChange={e=>change('country',e.target.value)}/>}</Field>
    {error?<Notice tone="error">{notices[error]?.[ar?0:1]??(ar?'لم يتم تأكيد إنشاء النشاط. استعد النتيجة باستخدام نفس الطلب المحفوظ.':'Creation has not been confirmed. Recover the result using the same saved request.')}</Notice>:null}
    <Button type="submit" busy={busy} disabled={!ready||!fields.name.trim()}>{pending?(ar?'استعادة نتيجة الإنشاء':'Recover creation result'):(ar?'إنشاء ومتابعة التجهيز':'Create and continue setup')}</Button>
  </form>;
}

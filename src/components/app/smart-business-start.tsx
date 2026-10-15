'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {createSmartBusiness} from '@/lib/tenancy/smart-business-start-actions';
import type {CompanyRecord} from '@/lib/tenancy/types';
import {type SmartStartFields,type SmartStartAttempt} from '@/lib/tenancy/smart-business-start-storage';
import {useOptionalAccountSession} from './account-chrome';
import {SetupEntry} from './setup-entry';
import {readBusinessCreationRecovery,persistBusinessCreationAttempt,settleBusinessCreationAttempt} from '@/lib/tenancy/business-creation-recovery';
import {rememberBusinessName} from '@/lib/field-suggestions';

type Fields=SmartStartFields;
type Attempt=SmartStartAttempt;
export function SmartBusinessStart({userId,ar,onCreated}:{userId:string;ar:boolean;onCreated:(company:CompanyRecord)=>void}){
  const session=useOptionalAccountSession(),router=useRouter();
  const [fields,setFields]=useState<Fields>({name:'',type:'other',country:'OM'});
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[pending,setPending]=useState(false);
  const operation=useRef<Attempt|null>(null),mounted=useRef(true),inFlight=useRef(false);
  const current=()=>mounted.current&&(!session||session.isCurrentUser(userId));
  const [recoveryReady,setRecoveryReady]=useState(false);
  const ready=recoveryReady&&(!session||session.status==='ready'&&session.identity?.userId===userId);
  const notices:Record<string,[string,string]>={
    LOCAL_STORAGE_UNAVAILABLE:['تعذّر حفظ الطلب في هذا المتصفح. اسمح بالتخزين ثم حاول مجددًا.','This browser could not save the request. Allow storage, then try again.'],
    LOCAL_RECOVERY_INVALID:['تعذّر قراءة طلب الإنشاء المحفوظ. أعد تحميل الصفحة قبل المتابعة.','The saved creation request could not be read. Reload before continuing.'],
    INVALID_INPUT:['راجع اسم النشاط ونوعه والدولة ثم حاول مجددًا.','Check the business name, type and country, then try again.'],
    PHONE_REQUIRED:['يلزم تأكيد هاتف حسابك قبل إنشاء النشاط.','Verify your account phone before creating a business.'],
    UNAUTHENTICATED:['سجّل الدخول مجددًا لاستكمال تجهيز نشاطك.','Sign in again to continue setting up your business.'],
    FORBIDDEN:['حسابك لا يملك صلاحية إنشاء هذا النشاط.','Your account cannot create this business.'],
    UNCONFIGURED:['إنشاء النشاط غير متاح حاليًا. حاول لاحقًا.','Business creation is currently unavailable. Try again later.'],
  };
  useEffect(()=>{mounted.current=true;const frame=requestAnimationFrame(()=>{if(session&&!session.isCurrentUser(userId))return;try{const saved=readBusinessCreationRecovery(localStorage,userId);if(saved){operation.current=saved;setFields(saved.fields);setPending(true);}setRecoveryReady(true);}catch{setError('LOCAL_RECOVERY_INVALID');}});return()=>{mounted.current=false;cancelAnimationFrame(frame);};},[userId,session]);
  function change(k:keyof Fields,v:string){if(!current()||pending)return;setFields(previous=>({...previous,[k]:v}));}
  async function submit(e:FormEvent){e.preventDefault();if(!ready||!current()||inFlight.current||!fields.name.trim()||!fields.type.trim()||!fields.country.trim())return;
    const previousAttempt=operation.current;
    operation.current??={id:crypto.randomUUID(),fields:{...fields}};const attempt=operation.current;
    try{persistBusinessCreationAttempt(localStorage,userId,attempt);}catch{if(!previousAttempt)operation.current=null;setError('LOCAL_STORAGE_UNAVAILABLE');return;}
    inFlight.current=true;setBusy(true);setPending(true);setError(null);
    try{const result=await createSmartBusiness({expectedUserId:userId,attemptId:attempt.id,...attempt.fields});if(!current())return;
      if(!result.ok){
        // These responses prove the request did not commit. Unknown outcomes
        // retain the exact durable attempt for receipt recovery instead.
        if(['INVALID_INPUT','UNCONFIGURED','FORBIDDEN','UNAUTHENTICATED'].includes(result.code)){
          try{settleBusinessCreationAttempt(localStorage,userId,attempt.id,'rejected');operation.current=null;setPending(false);}
          catch{setError('LOCAL_STORAGE_UNAVAILABLE');return;}
        }
        setError(result.code);return;
      }
      try{settleBusinessCreationAttempt(localStorage,userId,attempt.id,'confirmed',result.data.id);rememberBusinessName(localStorage,userId,attempt.fields.name);}catch{/* The native receipt remains authoritative; a pending request is safe to replay. */}
      onCreated(result.data);router.refresh();
    }catch{if(current())setError('UNAVAILABLE');}finally{inFlight.current=false;if(current())setBusy(false);}
  }
  return <SetupEntry ar={ar} fields={fields} ready={ready} busy={busy} pending={pending}
    error={error?(notices[error]?.[ar?0:1]??(ar?'لم يتم تأكيد إنشاء النشاط. استعد النتيجة باستخدام نفس الطلب المحفوظ.':'Creation has not been confirmed. Recover the result using the same saved request.')):null}
    onChange={change} onSubmit={submit} suggestionUserId={ready?userId:null} suggestionIsCurrent={current}/>;
}

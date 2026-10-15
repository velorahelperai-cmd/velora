'use client';
import Link from 'next/link';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {useDemo,emptyBusiness,type Business} from '@/lib/demo-state';
import {createBusinessAttempt} from '@/lib/tenancy/business-authority-actions';
import {selectWorkspaceCompany} from '@/lib/tenancy/actions';
import type {SetupDraftRecord} from '@/lib/tenancy/setup-draft';
import {useOptionalAccountSession} from './account-chrome';
import {Button,Field,Notice,useAction} from './ui';
import {WorkspaceShell} from './workspace-shell';
import {BusinessNameSuggestions} from './business-name-suggestions';
import {rememberBusinessName} from '@/lib/field-suggestions';
import {BusinessTypeCombobox} from './business-type-combobox';
type CreatorProps={userId:string;activeDraft:SetupDraftRecord|null;setupReturnTo?:string};
export function BusinessCreator(props:CreatorProps){return <Creator key={`${props.userId}:${props.activeDraft?.draftId??'new'}`} {...props}/>;}
function Creator({userId,activeDraft,setupReturnTo='/setup'}:CreatorProps){
 const {locale}=useDemo(),ar=locale==='ar',router=useRouter(),session=useOptionalAccountSession();
 const [business,setBusiness]=useState<Business>({...emptyBusiness,type:'other',country:'OM'});
 const [code,setCode]=useState<string|null>(null),attempt=useRef<string|null>(activeDraft?.draftId??null);
 const {busy,run}=useAction(),epoch=useRef(0),mounted=useRef(true);
 const storageKey=`velora_business_creation_attempt:${userId}`;
 const current=()=>mounted.current&&(!session||session.isCurrentUser(userId));
 const ready=!session||session.status==='ready'&&session.identity?.userId===userId;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function select(companyId:string){const result=await selectWorkspaceCompany(companyId,{expectedUserId:userId,next:setupReturnTo});if(!current())return;if(result.ok){router.push(result.data.next);router.refresh();}else setCode(result.code);}
 function submit(e:FormEvent){e.preventDefault();if(!ready||busy||!current())return;if(!attempt.current){let key:string|null=null;try{key=localStorage.getItem(storageKey);}catch{}if(!key||!/^[0-9a-f-]{36}$/i.test(key))key=crypto.randomUUID();attempt.current=key;try{localStorage.setItem(storageKey,key);}catch{}}const operation=attempt.current,request=++epoch.current;setCode(null);void run(async()=>{const result=await createBusinessAttempt({expectedUserId:userId,idempotencyKey:operation,business});if(!current()||request!==epoch.current)return;if(!result.ok){setCode(result.code);return;}try{localStorage.removeItem(storageKey);}catch{}try{rememberBusinessName(localStorage,userId,business.name);}catch{/* Optional suggestions never block a confirmed creation. */}await select(result.data.id);});}
 if(!ready)return <Notice>{ar?'جارٍ التحقق من الحساب الحالي…':'Checking the current account…'}</Notice>;
 const attached=activeDraft?.draft.companyId;
 const messages:Record<string,string>={PHONE_REQUIRED:ar?'وثّق هاتفك الشخصي قبل إنشاء النشاط.':'Verify your personal phone before creating a business.',DRAFT_ACTIVE:ar?'أكمل مسودة التجهيز الحالية أو ألغها صراحةً قبل إنشاء نشاط آخر.':'Complete or explicitly close the current setup draft before creating another business.',CONFLICT:ar?'تغيّرت بيانات محاولة الإنشاء. حدّث الصفحة لاستعادة الإيصال المحفوظ.':'The creation attempt changed. Refresh to recover its saved receipt.',THROTTLED:ar?'طلبات الإنشاء متقاربة جدًا. انتظر قليلًا ثم أعد المحاولة.':'Creation requests are too frequent. Wait briefly and retry.',INVALID_INPUT:ar?'أدخل اسم النشاط ونوعه ودولته بشكل صالح.':'Enter a valid business name, type and country.'};
 return <WorkspaceShell title={ar?'إنشاء نشاط جديد':'Create a business'}>
  <Notice>{ar?'لكل نشاط اشتراك ومعرفة وقنوات وصلاحيات مستقلة. إنشاء النشاط لا يمنح اشتراكًا أو أسبوعًا مجانيًا.':'Each business has its own subscription, knowledge, channels and permissions. Creation grants no subscription or free week.'}</Notice>
  {attached?<div className="mt-4 grid gap-3"><Notice tone="warn">{ar?'لديك تجهيز قائم. يمكنك متابعة التجهيز أو إلغاء مسودته من صفحة التجهيز. الأنشطة المكتملة الأخرى تظل متاحة.':'You have an active setup. Continue it or close its draft from setup. Your other completed businesses remain available.'}</Notice><Button busy={busy} onClick={()=>void run(()=>select(attached))}>{ar?'متابعة التجهيز الحالي':'Continue current setup'}</Button></div>:<form onSubmit={submit} className="mt-5 grid max-w-xl gap-4" noValidate>
   <Field label={ar?'اسم النشاط':'Business name'} hint={ar?'الاسم التجاري، مثل كراميلا برجر.':'Trading name, for example Caramella Burger.'} required>{p=><BusinessNameSuggestions id={p.id} value={business.name} ar={ar} userId={ready?userId:null} isCurrent={current} onChange={name=>setBusiness({...business,name})}/>}</Field>
<Field label={ar?'نوع النشاط':'Business type'} hint={ar?'مثل مطعم أو متجر إلكتروني؛ ابحث أو اختر وصفًا مخصصًا.':'For example, Restaurant or Online store. Search or choose a custom description.'} required>{p=><BusinessTypeCombobox id={p.id} value={business.type} ar={ar} disabled={busy} onChange={value=>setBusiness({...business,type:value})}/>}</Field>
   <Field label={ar?'الدولة':'Country'} required>{p=><input {...p} maxLength={80} value={business.country} onChange={e=>setBusiness({...business,country:e.target.value})}/>}</Field>
   <p className="text-sm">{ar?'يمكن استكمال ساعات العمل وبيانات التواصل والمعرفة بعد الإنشاء.':'Hours, contact details and knowledge can be completed after creation.'}</p>
   <Button type="submit" busy={busy} disabled={!ready}>{ar?'إنشاء ومتابعة التجهيز':'Create and continue setup'}</Button>
  </form>}
  {code&&<Notice tone="error">{messages[code]??(ar?'تعذّر تأكيد العملية. لم يُعرض نجاح غير مؤكد؛ أعد المحاولة بنفس الطلب.':'The operation could not be confirmed. Retry the same request.')} {code==='PHONE_REQUIRED'&&<Link href="/verify-phone?next=%2Faccount%2Fbusinesses%2Fnew">{ar?'توثيق الهاتف':'Verify phone'}</Link>}</Notice>}
 </WorkspaceShell>;
}

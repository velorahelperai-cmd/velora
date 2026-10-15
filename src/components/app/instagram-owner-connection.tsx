'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {loadInstagramOwnerConnection,startInstagramOwnerConnection,recoverInstagramOwnerConnection} from '@/lib/instagram/owner-actions';
import {Button,Notice} from './ui';
import {DiagnosticHint} from './diagnostic-hint';
type Loaded=Extract<Awaited<ReturnType<typeof loadInstagramOwnerConnection>>,{ok:true}>;
const messages:Record<string,[string,string]>={
 CONNECT_DISABLED:['Instagram connection is awaiting activation approval.','ربط إنستغرام ينتظر الموافقة على التفعيل.'],
 SETUP_REQUIRED:['Instagram connection setup is not ready.','إعداد ربط إنستغرام غير جاهز.'],
 SCHEMA_UNAVAILABLE:['Instagram storage is awaiting installation.','تخزين إنستغرام ينتظر التثبيت.'],
 RECONCILIATION_REQUIRED:['Checking connection. The previous valid connection is preserved.','جارٍ التحقق من الربط. الاتصال السابق الصالح محفوظ.'],
 FORBIDDEN:['Only the current workspace owner can manage this connection.','مالك مساحة العمل الحالية فقط يمكنه إدارة الربط.'],
 WORKSPACE_CHANGED:['The workspace changed. Refresh this page.','تغيّرت مساحة العمل. حدّث الصفحة.'],
 CONFLICT:['The connection changed. Refresh before disconnecting.','تغيّر الربط. حدّث الصفحة قبل فصله.'],
};
export function InstagramOwnerConnection({companyId,ar,callbackDiagnostic}:{companyId:string;ar:boolean;callbackResult?:string;callbackDiagnostic?:unknown}){
 const epoch=useRef(0),reserved=useRef(false);
 const [loaded,setLoaded]=useState<{companyId:string;value:Loaded}|null>(null),[error,setError]=useState<{companyId:string;code:string}|null>(null);
 const [busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 // Fence asynchronous navigation during commit, before passive load effects run.
 useLayoutEffect(()=>{const fence=epoch;fence.current++;reserved.current=false;return()=>{fence.current++;};},[companyId]);
 useEffect(()=>{const current=epoch.current;let cancelled=false;
  void(async()=>{await Promise.resolve();if(cancelled||current!==epoch.current)return;setBusy(false);setLoaded(null);setError(null);
   try{const r=await loadInstagramOwnerConnection({companyId});if(cancelled||current!==epoch.current)return;
    if(r.ok)setLoaded({companyId,value:r});else setError({companyId,code:r.code});
   }catch{if(!cancelled&&current===epoch.current)setError({companyId,code:'UNAVAILABLE'});}})();
  return()=>{cancelled=true;};
 },[companyId,refresh]);
 const status=loaded?.companyId===companyId?loaded.value:null;
 const code=error?.companyId===companyId?error.code:null;
 const unresolved=!!status&&['claimed','vault_staged','unknown'].includes(status.attemptKind??'');
 const connectReady=!!status&&status.connectEnabled&&status.contractReady&&!unresolved;
 async function connect(){
  if(!connectReady||reserved.current||busy)return;reserved.current=true;const current=epoch.current;setBusy(true);setError(null);
  try{const r=await startInstagramOwnerConnection({companyId});if(current!==epoch.current)return;
   if(!r.ok){setError({companyId,code:r.code});return;}
   const url=new URL(r.authorizationUrl);if(url.origin!=='https://www.instagram.com'||url.pathname!=='/oauth/authorize'||url.username||url.password){setError({companyId,code:'UNAVAILABLE'});return;}
   window.location.assign(url.href);
  }catch{if(current===epoch.current)setError({companyId,code:'RECONCILIATION_REQUIRED'});}finally{if(current===epoch.current){reserved.current=false;setBusy(false);}}
 }
 async function recover(){
  if(reserved.current||busy)return;reserved.current=true;const current=epoch.current;setBusy(true);setError(null);
  try{const r=await recoverInstagramOwnerConnection({companyId});if(current!==epoch.current)return;
   if(!r.ok)setError({companyId,code:r.code});setRefresh(n=>n+1);
  }catch{if(current===epoch.current)setError({companyId,code:'UNAVAILABLE'});}finally{if(current===epoch.current){reserved.current=false;setBusy(false);}}
 }
 const needsConnection=!status?.link||status.link.needsAuthorization===true;
 const blocker=code??(unresolved?'RECONCILIATION_REQUIRED':needsConnection&&status&&!status.connectEnabled?'CONNECT_DISABLED':needsConnection&&status&&!status.contractReady?'SETUP_REQUIRED':null);
 const callbackMessage=status?.attemptKind==='rejected'&&status.attemptReason==='account_mismatch'?(ar?'اختر نفس حساب إنستجرام المرتبط. لم نستبدل الاتصال السابق.':'Choose the same linked Instagram account. The previous connection was preserved.')
  :status?.attemptKind==='cancelled'?(ar?'أُلغيت محاولة الربط؛ الاتصال السابق الصالح محفوظ.':'Connection attempt cancelled; the previous valid connection is preserved.')
  :status?.attemptKind==='expired'?(ar?'انتهت محاولة التفويض؛ الاتصال السابق الصالح محفوظ.':'Authorization attempt expired; the previous valid connection is preserved.')
  :status?.attemptKind==='rejected'
  ?(ar?'لم يكتمل تفويض إنستغرام. يمكنك إعادة المحاولة.':'Instagram authorization was not completed. You can try again.')
  :unresolved
  ?messages.RECONCILIATION_REQUIRED[ar?1:0]
  :null;
 return <section aria-label={ar?'ربط إنستغرام':'Instagram connection'}>
  <h2>{ar?'ربط إنستغرام':'Instagram connection'}</h2>
  {callbackMessage&&<Notice>{callbackMessage}</Notice>}
  {callbackMessage&&<DiagnosticHint diagnostic={callbackDiagnostic} locale={ar?'ar':'en'}/>}
  {status?.link&&<p>{ar?'الحساب المرتبط: ':'Connected account: '}<span>{status.link.username?`@${status.link.username}`:status.link.accountId}</span> · {status.link.needsAuthorization===true?(ar?'يحتاج تجديد التفويض':'Authorization renewal needed'):status.link.needsAuthorization===false?(ar?'متصل':'Connected'):(ar?'جارٍ التحقق من الربط':'Checking connection')}</p>}
  {status?.link?.needsAuthorization&&<Notice>{ar?'انتهى التفويض أو لم تعد الصلاحيات المطلوبة متاحة. جدّد نفس حساب إنستجرام.':'Authorization expired or required permissions are missing. Renew the same Instagram account.'}</Notice>}
  {status?.subscriptionExpired&&<Notice>{ar?'انتهى الاشتراك؛ الردود متوقفة. هذه حالة دفع وليست طلب تفويض إنستجرام.':'Subscription expired; replies are paused. This is a billing state, separate from Instagram authorization.'} <a href='/app/subscription'>{ar?'التجديد ومواعيد الاحتفاظ':'Renewal and retention deadlines'}</a></Notice>}
  {status?.historyAccessible===false&&<Notice>{ar?'انتهت مهلة الربط والقراءة. جدّد الاشتراك وأعد ربط نفس الحساب لاستعادة السجل قبل الحذف.':'The connection and read grace period ended. Renew and reconnect the same account to restore history before deletion.'}</Notice>}
  {blocker&&<Notice>{messages[blocker]?.[ar?1:0]??(ar?'تعذّر إكمال الطلب. حدّث الصفحة.':'The request could not be completed. Refresh this page.')}</Notice>}
  {needsConnection&&<Button onClick={connect} disabled={busy||!connectReady}>{status?.link?.needsAuthorization?(ar?'تجديد الربط':'Renew connection'):(ar?'ربط إنستغرام':'Connect Instagram')}</Button>}
  {unresolved&&<Button onClick={recover} disabled={busy}>{ar?'التحقق من نتيجة الربط':'Check connection result'}</Button>}
  {status?.link&&<p>{ar?'لفصل الربط، تواصل مع إدارة Velora.':'Contact Velora support to disconnect.'}</p>}
 </section>;
}

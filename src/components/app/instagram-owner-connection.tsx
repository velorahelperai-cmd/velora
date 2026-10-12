'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {loadInstagramOwnerConnection,startInstagramOwnerConnection,disconnectInstagramOwnerConnection} from '@/lib/instagram/owner-actions';
import {Button,Notice} from './ui';
type Loaded=Extract<Awaited<ReturnType<typeof loadInstagramOwnerConnection>>,{ok:true}>;
const messages:Record<string,[string,string]>={
 CONNECT_DISABLED:['Instagram connection is awaiting activation approval.','ربط إنستغرام ينتظر الموافقة على التفعيل.'],
 SETUP_REQUIRED:['Instagram connection setup is not ready.','إعداد ربط إنستغرام غير جاهز.'],
 SCHEMA_UNAVAILABLE:['Instagram storage is awaiting installation.','تخزين إنستغرام ينتظر التثبيت.'],
 RECONCILIATION_REQUIRED:['The previous connection attempt needs review before reconnecting.','محاولة الربط السابقة تحتاج إلى مراجعة قبل إعادة الربط.'],
 FORBIDDEN:['Only the current workspace owner can manage this connection.','مالك مساحة العمل الحالية فقط يمكنه إدارة الربط.'],
 WORKSPACE_CHANGED:['The workspace changed. Refresh this page.','تغيّرت مساحة العمل. حدّث الصفحة.'],
 CONFLICT:['The connection changed. Refresh before disconnecting.','تغيّر الربط. حدّث الصفحة قبل فصله.'],
};
export function InstagramOwnerConnection({companyId,ar,callbackResult}:{companyId:string;ar:boolean;callbackResult?:string}){
 const epoch=useRef(0),reserved=useRef(false);
 const [loaded,setLoaded]=useState<{companyId:string;value:Loaded}|null>(null),[error,setError]=useState<{companyId:string;code:string}|null>(null);
 const [busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[disconnected,setDisconnected]=useState<string|null>(null);
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
 async function disconnect(){
  if(!status?.link||reserved.current||busy)return;reserved.current=true;const current=epoch.current;setBusy(true);setError(null);
  const input={companyId,linkId:status.link.linkId,expectedGeneration:status.generation};
  try{const r=await disconnectInstagramOwnerConnection(input);if(current!==epoch.current)return;
   if(r.ok){setDisconnected(companyId);setLoaded(null);setRefresh(n=>n+1);}else setError({companyId,code:r.code});
  }catch{if(current===epoch.current)setError({companyId,code:'UNAVAILABLE'});}finally{if(current===epoch.current){reserved.current=false;setBusy(false);}}
 }
 const blocker=code??(unresolved?'RECONCILIATION_REQUIRED':status&&!status.connectEnabled?'CONNECT_DISABLED':status&&!status.contractReady?'SETUP_REQUIRED':null);
 const callbackMessage=callbackResult==='not_authorized'
  ?(ar?'لم يكتمل تفويض إنستغرام. يمكنك إعادة المحاولة.':'Instagram authorization was not completed. You can try again.')
  :callbackResult==='needs_review'
  ?messages.RECONCILIATION_REQUIRED[ar?1:0]
  :callbackResult==='setup_required'?messages.SETUP_REQUIRED[ar?1:0]:null;
 return <section aria-label={ar?'ربط إنستغرام':'Instagram connection'}>
  <h2>{ar?'ربط إنستغرام':'Instagram connection'}</h2>
  {callbackMessage&&<Notice>{callbackMessage}</Notice>}
  {status?.link&&<p>{ar?'الحساب المرتبط: ':'Connected account: '}<span>{status.link.accountId}</span></p>}
  {blocker&&<Notice>{messages[blocker]?.[ar?1:0]??(ar?'تعذّر إكمال الطلب. حدّث الصفحة.':'The request could not be completed. Refresh this page.')}</Notice>}
  {disconnected===companyId&&<p role="status">{ar?'تم فصل الربط في Velora مع الاحتفاظ بالسجل. إذن إنستغرام يُدار بشكل منفصل.':'Disconnected from Velora; history is retained. Instagram permission is managed separately.'}</p>}
  <Button onClick={connect} disabled={busy||!connectReady}>{ar?'ربط إنستغرام':'Connect Instagram'}</Button>
  {status?.link&&<Button onClick={disconnect} disabled={busy}>{ar?'فصل الربط من Velora':'Disconnect from Velora'}</Button>}
 </section>;
}

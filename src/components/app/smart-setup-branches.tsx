'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {readSmartSetup,saveSmartBranchSettings,createSmartBranch,renameSmartBranch} from '@/lib/tenancy/smart-onboarding-actions';
import type {SmartBranchSetup} from '@/lib/tenancy/smart-onboarding';
import {Button} from './ui';
import {useSmartAccountGuard,useSmartAutosave} from './use-smart-autosave';
import {SmartAutosaveStatus} from './smart-autosave-status';
import styles from './smart-setup.module.css';
type Props={userId:string;companyId:string;locale:'ar'|'en';setup:SmartBranchSetup;onSaved:(setup:SmartBranchSetup)=>void;onClose:()=>void};
type Choice={mode:'single'|'multiple';name:string};
const validChoice=(v:unknown):v is Choice=>!!v&&typeof v==='object'&&['single','multiple'].includes((v as Choice).mode)&&typeof (v as Choice).name==='string'&&(v as Choice).name.length<=120;
export function SmartSetupBranches(props:Props){
 const {userId,companyId,locale,onSaved}=props,current=useSmartAccountGuard(userId,companyId),scope=`${userId}:${companyId}`;
 const [loaded,setLoaded]=useState<{scope:string;setup:SmartBranchSetup}|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0),saved=useRef(onSaved);
 useLayoutEffect(()=>{saved.current=onSaved;},[onSaved]);
 // A previous editor may have closed before its server write completed. Read
 // the authoritative result before exposing an editable cached branch again.
 useEffect(()=>{let cancelled=false;
  void readSmartSetup({expectedUserId:userId,expectedCompanyId:companyId}).then(result=>{
   if(cancelled||!current())return;
   if(!result.ok){setFailed(true);return;}
   setLoaded({scope,setup:result.data.branchSetup});setFailed(false);saved.current(result.data.branchSetup);
  }).catch(()=>{if(!cancelled&&current())setFailed(true);});
  return()=>{cancelled=true;};
 },[userId,companyId,current,scope,retry]);
 const setup=current()&&loaded?.scope===scope?loaded.setup:null,ar=locale==='ar';
 if(!setup)return failed?<div><p role="alert">{ar?'تعذّر قراءة إعدادات الفروع المحفوظة. أعد المحاولة.':'Could not read saved branch settings. Retry.'}</p><Button type="button" onClick={()=>{setFailed(false);setRetry(value=>value+1);}}>{ar?'إعادة المحاولة':'Retry'}</Button></div>:<p role="status">{ar?'جارٍ تحميل إعدادات الفروع المحفوظة…':'Loading saved branch settings…'}</p>;
 const p=setup.branches.find(b=>b.primary);return p?<BranchSettings key={`${scope}:${p.id}`} {...props} setup={setup} primary={p}/>:<p role="alert">Main branch unavailable.</p>;
}
function BranchSettings({userId,companyId,locale,setup,onSaved,onClose,primary}:Props&{primary:SmartBranchSetup['branches'][number]}){
 const ar=locale==='ar',current=useSmartAccountGuard(userId,companyId),[branches,setBranches]=useState(setup.branches),[reloadError,setReloadError]=useState(false),receipt=useRef<SmartBranchSetup|null>(null),live=useRef(true);
 useLayoutEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const autosave=useSmartAutosave<Choice>({scope:`${userId}:${companyId}:${primary.id}:choice`,value:{mode:setup.mode??(setup.branches.length>1?'multiple':'single'),name:primary.name},revision:setup.revision,digest:primary.name,validate:validChoice,current,
  save:async a=>{const r=await saveSmartBranchSettings({expectedUserId:userId,expectedCompanyId:companyId,attemptId:a.id,expectedPrimaryBranchId:primary.id,expectedRevision:a.revision,expectedPrimaryName:a.digest,primaryName:a.value.name,mode:a.value.mode});if(!r.ok)return r;receipt.current=r.data;const p=r.data.branches.find(b=>b.primary)!;return {ok:true,data:{value:{mode:r.data.mode!,name:p.name},revision:r.data.revision,digest:p.name}};},committed:()=>{if(receipt.current){setBranches(receipt.current.branches);onSaved(receipt.current);}}});
 async function refresh(){if(!current())return null;const r=await readSmartSetup({expectedUserId:userId,expectedCompanyId:companyId});if(!live.current||!current())return null;if(r.ok){setBranches(r.data.branchSetup.branches);onSaved(r.data.branchSetup);return r.data.branchSetup;}setReloadError(true);return null;}
 async function reload(){if(!window.confirm(ar?'استبدال تعديلاتك بإعدادات الفروع المحفوظة؟':'Replace your edits with saved branch settings?'))return;const s=await refresh(),p=s?.branches.find(b=>b.id===primary.id&&b.primary);if(s&&p){autosave.reload({mode:s.mode??'single',name:p.name},s.revision,p.name);setReloadError(false);}}
 const state=autosave.state;if(!state)return <p role="status">{ar?'جارٍ استعادة التعديلات…':'Restoring edits…'}</p>;
 return <div className={styles.branchForm}>
 <fieldset className={styles.choices}><legend>{ar?'نشاطك له فرع واحد ولا عدة فروع؟':'Does your business have one branch or several?'}</legend>{(['single','multiple'] as const).map(mode=><label className={styles.choice} key={mode}><input type="radio" name={`mode-${primary.id}`} checked={state.value.mode===mode} disabled={mode==='single'&&branches.filter(b=>b.status==='active').length>1} onChange={()=>autosave.edit({...state.value,mode})}/>{mode==='single'?(ar?'فرع واحد':'One branch'):(ar?'عدة فروع':'Several branches')}</label>)}</fieldset>
 <label>{ar?'اسم الفرع الرئيسي':'Main branch name'}<input value={state.value.name} maxLength={120} required onChange={e=>autosave.edit({...state.value,name:e.target.value})}/></label>
 <SmartAutosaveStatus ar={ar} status={state.status} code={state.code} onRetry={()=>void autosave.retry()} onReload={()=>void reload()}/>
 {reloadError?<p role="alert">{ar?'تعذر قراءة أحدث إعدادات الفروع.':'Could not read latest branch settings.'}</p>:null}
 {state.value.mode==='multiple'?<><AddBranch userId={userId} companyId={companyId} ar={ar} onRefresh={refresh}/>{branches.filter(b=>!b.primary).map(branch=><SecondaryBranch key={`${userId}:${companyId}:${branch.id}`} userId={userId} companyId={companyId} branch={branch} ar={ar} onRefresh={refresh}/>)}</>:null}
 <Button type="button" variant="secondary" onClick={onClose}>{ar?'العودة للتجهيز':'Return to setup'}</Button></div>;
}
type BranchProps={userId:string;companyId:string;ar:boolean;onRefresh:()=>Promise<SmartBranchSetup|null>};
function AddBranch({userId,companyId,ar,onRefresh}:BranchProps){
 const current=useSmartAccountGuard(userId,companyId);
 const [name,setName]=useState(''),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState<string|null>(null),attempt=useRef<{id:string;name:string;timezone:string}|null>(null),live=useRef(true);
 const key=`velora_smart_branch_create_v1:${userId}:${companyId}`;
 useEffect(()=>{live.current=true;const frame=window.requestAnimationFrame(()=>{try{const raw=window.localStorage.getItem(key);if(raw){const saved=JSON.parse(raw);if(typeof saved.id==='string'&&typeof saved.name==='string'&&typeof saved.timezone==='string'){attempt.current=saved;setName(saved.name);setLocked(true);setError('UNAVAILABLE');}}}catch{setError('STORAGE_UNAVAILABLE');}setReady(true);});return()=>{live.current=false;window.cancelAnimationFrame(frame);};},[key]);
 async function add(){if(!current()||busy||!name.trim())return;const newAttempt=attempt.current===null;attempt.current??={id:crypto.randomUUID(),name,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Muscat'};const submitted=attempt.current;try{window.localStorage.setItem(key,JSON.stringify(submitted));}catch{if(newAttempt)attempt.current=null;setError('STORAGE_UNAVAILABLE');return;}setLocked(true);setBusy(true);setError(null);try{const r=await createSmartBranch({expectedUserId:userId,expectedCompanyId:companyId,attemptId:submitted.id,name:submitted.name,timezone:submitted.timezone});if(!live.current||!current())return;if(r.ok){setName('');attempt.current=null;setLocked(false);try{window.localStorage.removeItem(key);}catch{/* The native creation receipt is confirmed. */}await onRefresh();}else{setError(r.code);if(r.code!=='UNAVAILABLE'){attempt.current=null;setLocked(false);window.localStorage.removeItem(key);}}}catch{if(live.current&&current())setError('UNAVAILABLE');}finally{if(live.current&&current())setBusy(false);}}
 return <div><label>{ar?'اسم فرع جديد':'New branch name'}<input value={name} maxLength={120} disabled={busy||locked||!ready} onChange={e=>{if(current())setName(e.target.value);}}/></label><Button type="button" busy={busy} disabled={!name.trim()||!ready} onClick={()=>void add()}>{error==='UNAVAILABLE'?(ar?'إعادة محاولة إضافة نفس الفرع':'Retry adding the same branch'):(ar?'إضافة فرع':'Add branch')}</Button>{error?<p role="alert">{ar?'لم يتم تأكيد الإضافة. أعد المحاولة.':'Branch addition was not confirmed. Retry.'}</p>:null}</div>;
}
function SecondaryBranch({userId,companyId,ar,onRefresh,branch}:BranchProps&{branch:SmartBranchSetup['branches'][number]}){
 const current=useSmartAccountGuard(userId,companyId);
 const autosave=useSmartAutosave<string>({scope:`${userId}:${companyId}:${branch.id}:name`,value:branch.name,revision:0,digest:branch.name,current,validate:(v):v is string=>typeof v==='string'&&v.length<=120,
  save:async a=>{const r=await renameSmartBranch({expectedUserId:userId,expectedCompanyId:companyId,attemptId:a.id,branchId:branch.id,expectedName:a.digest,name:a.value});return r.ok?{ok:true,data:{value:r.data.name!,revision:0,digest:r.data.name!}}:r;},committed:()=>{void onRefresh();}});
 async function reload(){if(!window.confirm(ar?'استبدال تعديلاتك بالاسم المحفوظ؟':'Replace your edits with the saved branch name?'))return;const s=await onRefresh(),b=s?.branches.find(b=>b.id===branch.id);if(b)autosave.reload(b.name,0,b.name);}
 const state=autosave.state;if(!state)return null;
 return <div><label>{ar?'اسم الفرع':'Branch name'}<input value={state.value} maxLength={120} disabled={branch.status==='suspended'} onChange={e=>autosave.edit(e.target.value)}/></label><SmartAutosaveStatus ar={ar} status={state.status} code={state.code} onRetry={()=>void autosave.retry()} onReload={()=>void reload()}/></div>;
}

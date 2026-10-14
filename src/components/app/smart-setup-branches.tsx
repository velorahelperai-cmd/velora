'use client';
import {useEffect,useRef,useState} from 'react';
import {saveSmartBranchSetup} from '@/lib/tenancy/smart-onboarding-actions';
import type {SmartBranchSetup} from '@/lib/tenancy/smart-onboarding';
import {Button,LinkButton} from './ui';
import styles from './smart-setup.module.css';

export function SmartSetupBranches({userId,companyId,locale,setup,onSaved,onClose}:{userId:string;companyId:string;locale:'ar'|'en';setup:SmartBranchSetup;onSaved:(setup:SmartBranchSetup)=>void;onClose:()=>void}){
 const ar=locale==='ar',primary=setup.branches.find(b=>b.primary);
 const [mode,setMode]=useState<'single'|'multiple'>(setup.mode??(setup.branches.length>1?'multiple':'single'));
 const [name,setName]=useState(primary?.name??(ar?'الفرع الرئيسي':'Main branch'));
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const pending=useRef(false),scope=useRef<string|null>(null);
 useEffect(()=>{scope.current=`${userId}:${companyId}`;return()=>{scope.current=null;};},[userId,companyId]);
 async function save(e:React.FormEvent){
  e.preventDefault();if(pending.current||!name.trim())return;const rendered=scope.current;
  pending.current=true;setBusy(true);setError(null);
  try{const result=await saveSmartBranchSetup({expectedUserId:userId,expectedCompanyId:companyId,expectedRevision:setup.revision,mode,primaryName:name,expectedPrimaryName:primary?.name??''});
   if(scope.current!==rendered)return;
   if(result.ok){onSaved(result.data);onClose();}else setError(result.code);
  }catch{if(scope.current===rendered)setError('UNAVAILABLE');}finally{pending.current=false;if(scope.current===rendered)setBusy(false);}
 }
 return <form className={styles.branchForm} onSubmit={save}>
  <fieldset className={styles.choices} disabled={busy}><legend>{ar?'نشاطك له فرع واحد ولا عدة فروع؟':'Does your business have one branch or several?'}</legend>
   <label className={styles.choice}><input type="radio" name="branch-mode" value="single" checked={mode==='single'} disabled={setup.branches.filter(b=>b.status==='active').length>1} onChange={()=>setMode('single')} />{ar?'فرع واحد':'One branch'}</label>
   <label className={styles.choice}><input type="radio" name="branch-mode" value="multiple" checked={mode==='multiple'} onChange={()=>setMode('multiple')} />{ar?'عدة فروع':'Several branches'}</label>
  </fieldset>
  <label>{ar?'اسم الفرع الرئيسي':'Main branch name'}<input type="text" required maxLength={120} value={name} disabled={busy} onChange={e=>setName(e.target.value)} autoComplete="off" /></label>
  <p className={styles.note}>{ar?'تم إنشاء فرع رئيسي لنشاطك. حفظ الاختيار لا يربط قناة أو اشتراكًا بالفرع.':'A main branch has been created for your business. Saving this choice does not connect a channel or subscription to the branch.'}</p>
  <ul className={styles.note}>{setup.branches.map(branch=><li key={branch.id}>{branch.name} · {branch.status==='active'?(ar?'جاهز':'Ready'):branch.status==='setup'?(ar?'قيد التجهيز':'In setup'):(ar?'موقوف':'Suspended')}</li>)}</ul>
  {mode==='multiple'?<div className={styles.note}><p>{ar?'يمكنك إضافة بقية الفروع بأسمائها الآن أو لاحقًا.':'Add your other branches by name now or later.'}</p><LinkButton href="/app/organization" variant="secondary">{ar?'إضافة وإدارة الفروع':'Add and manage branches'}</LinkButton></div>:null}
  {error?<p role="alert">{error==='CONFLICT'?(ar?'تغيرت إعدادات الفروع في جلسة أخرى. ارجع للبطاقات وأعد تحميلها قبل الحفظ.':'Branch settings changed in another session. Return to the cards and reload before saving.'):(ar?'لم يتم تأكيد الحفظ. راجع البيانات وأعد المحاولة.':'Save was not confirmed. Check the fields and retry.')}</p>:null}
  <div className={styles.actions}><Button type="submit" busy={busy} disabled={!name.trim()}>{ar?'حفظ والعودة للتجهيز':'Save and return to setup'}</Button><Button variant="secondary" disabled={busy} onClick={onClose}>{ar?'الاستكمال لاحقًا':'Continue later'}</Button></div>
 </form>;
}

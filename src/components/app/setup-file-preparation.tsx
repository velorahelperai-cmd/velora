'use client';
import {useEffect,useRef,useState} from 'react';
import {beginSetupDraft} from '@/lib/tenancy/setup-draft-actions';
import {emptyCompanyDraft} from '@/lib/company-draft';
import type {SetupDraftRecord} from '@/lib/tenancy/setup-draft';
import type {CompanyRecord} from '@/lib/tenancy/types';
import {companyBusiness} from './onboarding-contracts';
import {Button} from './ui';
/** Temporary compatibility boundary: the existing upload API requires a lifecycle scope.
 * It receives only confirmed company facts, never the edited form or a restored field draft. */
export function SetupFilePreparation({userId,company,ar,onPrepared}:{userId:string;company:CompanyRecord;ar:boolean;onPrepared:(record:SetupDraftRecord)=>void}){
 const mounted=useRef(true);useEffect(()=>()=>{mounted.current=false;},[]);
 const attempt=useRef<string|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 async function prepare(){if(busy)return;setBusy(true);setFailed(false);attempt.current??=crypto.randomUUID();
  try{const result=await beginSetupDraft({expectedUserId:userId,expectedCompanyId:company.id,attemptId:attempt.current,draft:{...emptyCompanyDraft(userId),companyId:company.id,business:companyBusiness(company),setupStep:3}});if(!mounted.current)return;if(result.ok)onPrepared(result.data);else setFailed(true);}catch{if(mounted.current)setFailed(true);}finally{setBusy(false);}
 }
 return <div className="mb-4 grid gap-2"><p>{ar?'ابدأ إضافة ملفات المعرفة إلى نشاطك.':'Start adding knowledge files to your business.'}</p><Button type="button" busy={busy} onClick={()=>void prepare()}>{ar?'تجهيز إضافة الملفات':'Prepare file upload'}</Button>{failed?<p role="alert">{ar?'تعذّر تجهيز رفع الملفات. أعد المحاولة.':'File upload could not be prepared. Retry.'}</p>:null}</div>;
}

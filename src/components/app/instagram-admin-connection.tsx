'use client';
import {useEffect,useRef,useState} from 'react';
import {loadInstagramAdminConnection,disconnectInstagramAdminConnection} from '@/lib/instagram/owner-actions';
import {Button} from './ui';
export function InstagramAdminConnection({companyId}:{companyId:string}){
 const epoch=useRef(0),[loaded,setLoaded]=useState<{companyId:string;value:{linkId:string;generation:number;accountId:string}|null}|null>(null),[busy,setBusy]=useState(false),[armed,setArmed]=useState(false),[message,setMessage]=useState('');
 const link=loaded?.companyId===companyId?loaded.value:null;
 useEffect(()=>{const fence=epoch,n=++fence.current;void loadInstagramAdminConnection({companyId}).then(r=>{if(n===fence.current){setLoaded({companyId,value:r.ok?r.link:null});setArmed(false);setBusy(false);setMessage('');}}).catch(()=>{});return()=>{fence.current++;};},[companyId]);
 async function disconnect(){if(!link||busy||!armed)return;const n=epoch.current;setBusy(true);try{const r=await disconnectInstagramAdminConnection({companyId,linkId:link.linkId,expectedGeneration:link.generation});if(n!==epoch.current)return;if(r.ok){setLoaded({companyId,value:null});setMessage('أُزيل ربط Velora محليًا وسُجّل الإجراء. إلغاء التفويض لدى المزود غير مؤكد؛ السجل محفوظ.');}else setMessage('تعذر الفصل. حدّث الحالة؛ لم نؤكد إجراء الفصل.');}catch{if(n===epoch.current)setMessage('النتيجة غير محسومة. حدّث الحالة قبل أي محاولة أخرى.');}finally{if(n===epoch.current)setBusy(false);}}
 return <section aria-label='إدارة ربط إنستجرام'>{link&&<><p>حساب إنستجرام: <bdi>{link.accountId}</bdi></p><label><input type='checkbox' checked={armed} disabled={busy} onChange={e=>setArmed(e.target.checked)}/> فصل محلي إداري مع الاحتفاظ بالسجل وتسجيل الإجراء</label><Button disabled={!armed||busy} onClick={()=>void disconnect()}>إزالة ربط Velora محليًا</Button></>}{message&&<p role='status'>{message}</p>}</section>;
}

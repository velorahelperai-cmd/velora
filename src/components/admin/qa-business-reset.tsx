'use client';
import {useState} from 'react';
import {resetQaBusiness} from '@/lib/tenancy/qa-business-grant-actions';
export function QaBusinessReset({grants}:{grants:Array<{companyId:string;name:string;persona:string;package:string;term:string}>}){
 const [id,setId]=useState(''),[confirmation,setConfirmation]=useState(''),[preview,setPreview]=useState<Record<string,unknown>|null>(null),[busy,setBusy]=useState(false);
 async function run(commit=false){setBusy(true);try{setPreview(await resetQaBusiness(id,commit?confirmation:undefined));}catch{setPreview({ok:false,code:'UNKNOWN'});}finally{setBusy(false);}}
 return <section dir="rtl" className="space-y-4 p-6"><h1>إعادة ضبط VELORA QA</h1><p>أرشفة نشاط التجربة وإلغاء الوصول لبدء تجربة جديدة. يحتفظ النظام بالسجل السابق؛ لا يُحذف الحساب أو سجل الدفع. تُرفض الشركات الأخرى والارتباطات التي تتطلب مراجعة.</p>
 <label>نشاط التجربة<select value={id} disabled={busy} onChange={e=>{setId(e.target.value);setPreview(null);setConfirmation('');}} className="block border p-2"><option value="">اختر التجربة</option>{grants.map(g=><option key={g.companyId} value={g.companyId}>{g.name} — {g.persona} / {g.package} / {g.term}</option>)}</select></label>
 <button disabled={busy||!id} onClick={()=>void run()}>عرض نطاق إعادة الضبط</button>
 {preview&&<output className="block"><pre>{JSON.stringify(preview,null,2)}</pre></output>}
 {preview?.ok===true&&preview.operation==='archive_and_revoke'&&<><label>اكتب RESET VELORA QA للتأكيد<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="block border p-2"/></label><button disabled={busy||confirmation!=='RESET VELORA QA'} onClick={()=>void run(true)}>أرشفة التجربة وإتاحة البدء من جديد</button></>}
 </section>;
}

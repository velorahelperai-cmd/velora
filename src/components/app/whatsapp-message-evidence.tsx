'use client';
import {useEffect,useState} from 'react';
import {readWhatsappMessageEvidence} from '@/lib/whatsapp/message-evidence-actions';
import type {WhatsappMessageEvidence as Evidence} from '@/lib/whatsapp/message-evidence';
import {Button} from './ui';

export function WhatsappMessageEvidence({companyId,linkId,ar}:{companyId:string;linkId:string;ar:boolean}){
 const [version,setVersion]=useState(0);
 const [snapshot,setSnapshot]=useState<{scope:string;data:Evidence|null}|null>(null);
 const scope=companyId+':'+linkId;
 useEffect(()=>{
  let active=true;
  void readWhatsappMessageEvidence({companyId,linkId}).then(result=>{
   if(active)setSnapshot({scope:companyId+':'+linkId,data:result.ok?result.data:null});
  }).catch(()=>{if(active)setSnapshot({scope:companyId+':'+linkId,data:null});});
  return()=>{active=false;};
 },[companyId,linkId,version]);
 const current=snapshot?.scope===scope?snapshot:null;
 const stamp=(value:string|null)=>value?new Intl.DateTimeFormat(ar?'ar-OM':'en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):(ar?'لا يوجد دليل مسجّل':'No recorded evidence');
 return <section aria-label={ar?'دليل الرسائل الفعلية':'Actual message evidence'} className="my-4 rounded-xl border border-[var(--color-border-soft)] p-4">
  <div className="flex items-center justify-between gap-3"><h3>{ar?'دليل الرسائل الفعلية':'Actual message evidence'}</h3><Button type="button" variant="secondary" busy={!current} onClick={()=>{setSnapshot(null);setVersion(n=>n+1);}}>{ar?'تحديث الدليل':'Refresh evidence'}</Button></div>
  {!current?<p role="status">{ar?'جارٍ التحقق من سجلات الرسائل…':'Checking message records…'}</p>:!current.data?<p role="status">{ar?'تعذّر التحقق من دليل الرسائل الآن.':'Message evidence could not be verified right now.'}</p>:<dl>
   <div><dt>{ar?'آخر رسالة واردة في سجل النشاط':'Latest inbound message in business history'}</dt><dd>{stamp(current.data.latestCompanyInboundAt)}</dd></div>
   <div><dt>{ar?'آخر تسليم مؤكّد على الربط الحالي':'Latest confirmed delivery on the current connection'}</dt><dd>{stamp(current.data.currentLinkDeliveredAt)}</dd></div>
  </dl>}
  <p className="text-sm">{ar?'سجل الاستقبال قد يتضمن رسائل قبل الربط الحالي. دليل التسليم يخص الربط الحالي؛ لا يفعّل الإرسال أو المساعد أو الاشتراك.':'Inbound history may include messages from before this connection. Delivery evidence belongs to the current connection; it does not enable sending, the assistant or a subscription.'}</p>
 </section>;
}

'use client';
import {useEffect,useState} from 'react';
import {adminGrantChannelReview,adminRevokeChannelReview,readChannelReviewAccess,adminStartInstagramReviewBootstrap,adminReadInstagramReviewBootstrap} from '@/lib/meta-review/actions';
import type {ReviewChannel,ReviewGrant} from '@/lib/meta-review/access';
import {useDemo} from '@/lib/demo-state';
import {Button,Notice} from './ui';
export function ChannelReviewStatus({companyId,channel}:{companyId:string;channel:ReviewChannel}){
 const {locale}=useDemo(),ar=locale==='ar';const [grant,setGrant]=useState<ReviewGrant|null>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{let cancelled=false;void readChannelReviewAccess(companyId,channel).then(r=>{if(!cancelled){setGrant(r.ok?r.grant:null);setLoading(false);}}).catch(()=>{if(!cancelled){setGrant(null);setLoading(false);}});return()=>{cancelled=true;};},[companyId,channel]);
 return <section aria-label={ar?'تصريح مراجعة ميتا':'Meta review access'} className="my-4 grid gap-2">
  <h3>{ar?'تصريح مراجعة ميتا':'Meta review access'}</h3>
  {loading?<p aria-busy="true">{ar?'جارٍ التحقق…':'Checking…'}</p>:grant?<>
   <p>{ar?'ردود يدوية فقط، دون AI. ليست حالة اشتراك مدفوع.':'Manual replies only, without AI. This is separate from a paid subscription.'}</p>
   <p>{ar?'المحاولات المحجوزة: ':'Reserved attempts: '}{grant.used_count} / {grant.send_limit}</p>
   <p>{ar?'ينتهي: ':'Expires: '}{new Date(grant.expires_at).toLocaleString(ar?'ar-OM':'en-GB',{timeZone:'Asia/Muscat'})}</p>
  </>:<Notice>{ar?'لا يوجد تصريح مراجعة صالح لهذا الحساب. الربط والإرسال يحتاجان أدلتهما بشكل منفصل.':'No valid review access for this account. Connection and sending require separate evidence.'}</Notice>}
 </section>;
}
export function AdminChannelReview({companyId}:{companyId:string}){
 const {locale}=useDemo(),ar=locale==='ar';const [channel,setChannel]=useState<ReviewChannel>('whatsapp'),[asset,setAsset]=useState(''),[source,setSource]=useState(''),[recipients,setRecipients]=useState(''),[grant,setGrant]=useState<ReviewGrant|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [bootstrapNonce,setBootstrapNonce]=useState('');
 async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setMessage('');try{
  const r=await adminGrantChannelReview({companyId,channel,assetId:asset.trim(),sourceAccountId:channel==='instagram'?asset.trim():source.trim(),recipientIds:recipients.split(',').map(v=>v.trim())});
  if(r.ok){setGrant(r.grant);setMessage(ar?'تم حفظ تصريح المراجعة.':'Review access saved.');}else setMessage(ar?'تعذر إصدار التصريح. تحقق من إعداد الاختبار والأصول والمستلمين.':'Could not issue access. Check test configuration, assets and recipients.');
 }catch{setMessage(ar?'تعذر حفظ التصريح.':'Could not save access.');}finally{setBusy(false);}}
 return <section className="my-6 rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 text-[var(--service-ink)]" aria-label={ar?'إدارة تصريح مراجعة ميتا':'Manage Meta review access'}>
  <h2 className="text-xl font-bold">{ar?'تصريح مراجعة ميتا':'Meta review access'}</h2>
  <p className="my-2">{ar?'٧ أيام، ٥٠ محاولة رد يدوي لكل قناة. لا دفع وهمي ولا AI. إصدار التصريح لا يثبت ربط ميتا أو وصول الرسائل.':'7 days, 50 manual dispatch attempts per channel. Separate from billing and AI. Issuing access does not prove a Meta connection or message delivery.'}</p>
  {channel==='instagram'&&<div className="my-4 grid gap-2">
   <label>{ar?'نص تحقق سابق لإعادة فحصه (اختياري)':'Previous challenge to verify again (optional)'}<input dir="ltr" className="mt-1 min-h-11 w-full rounded border px-3" value={bootstrapNonce} disabled={busy} onChange={e=>setBootstrapNonce(e.target.value)}/></label>
   <Button disabled={busy} onClick={()=>{setBusy(true);void adminStartInstagramReviewBootstrap(companyId,bootstrapNonce||undefined).then(r=>{if(r.ok)setBootstrapNonce(r.nonce);else setMessage(ar?'تعذر بدء تحقق الاستقبال.':'Could not start receive verification.');}).finally(()=>setBusy(false));}}>{ar?'بدء تحقق استقبال إنستجرام':'Start Instagram receive verification'}</Button>
   {bootstrapNonce&&<p>{ar?'أرسل النص التالي خلال ٣٠ دقيقة من حساب الاختبار العادي إلى الحساب الاحترافي المرتبط:':'Within 30 minutes, send this exact text from your ordinary test account to the connected professional account:'} <code dir="ltr">{bootstrapNonce}</code></p>}
   <Button disabled={busy} onClick={()=>{setBusy(true);void adminReadInstagramReviewBootstrap(companyId).then(r=>{if(r.ok&&r.observed&&r.accountId&&r.senderId){setAsset(r.accountId);setRecipients(r.senderId);setMessage(ar?'تم إثبات الاستقبال من ميتا. يمكنك إصدار تصريح الرد لهذا المرسل.':'Meta receipt verified. You can issue reply access for this sender.');}else setMessage(ar?'لم تصل رسالة التحقق الموقعة بعد.':'The signed verification message has not arrived yet.');}).finally(()=>setBusy(false));}}>{ar?'فحص رسالة التحقق':'Check verification message'}</Button>
  </div>}
  <form onSubmit={e=>void submit(e)} className="grid gap-3">
   <label>{ar?'القناة':'Channel'}<select className="ms-2 min-h-11 rounded border px-2" value={channel} disabled={busy} onChange={e=>{setChannel(e.target.value as ReviewChannel);setGrant(null);setMessage('');}}><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option></select></label>
   <label>{ar?'معرف رقم واتساب الاختباري أو حساب إنستجرام الاحترافي':'Test WhatsApp phone ID or professional Instagram account ID'}<input required dir="ltr" className="mt-1 min-h-11 w-full rounded border bg-white px-3" value={asset} disabled={busy} onChange={e=>setAsset(e.target.value)}/></label>
   {channel==='whatsapp'&&<label>Test WABA ID<input required dir="ltr" className="mt-1 min-h-11 w-full rounded border bg-white px-3" value={source} disabled={busy} onChange={e=>setSource(e.target.value)}/></label>}
   <label>{ar?'معرفات المستلمين المسموحين، مفصولة بفاصلة':'Allowed recipient IDs, comma-separated'}<input required dir="ltr" className="mt-1 min-h-11 w-full rounded border bg-white px-3" value={recipients} disabled={busy} onChange={e=>setRecipients(e.target.value)}/></label>
   <p className="text-sm">{ar?'واتساب: الرقم الدولي بأرقام فقط. إنستجرام: معرف المرسل من رسالة الاختبار الواردة الموثقة، وليس اسم المستخدم.':'WhatsApp: international digits only. Instagram: sender ID from the verified inbound test message, rather than a username.'}</p>
   <Button type="submit" disabled={busy}>{ar?'إصدار تصريح المراجعة':'Issue review access'}</Button>
  </form>
  {message&&<p role="status" className="mt-3">{message}</p>}
  {grant&&<><p>{grant.used_count} / {grant.send_limit} · {new Date(grant.expires_at).toLocaleString(ar?'ar-OM':'en-GB',{timeZone:'Asia/Muscat'})}</p>
   <Button disabled={busy} onClick={()=>{setBusy(true);void adminRevokeChannelReview(grant.id).then(r=>{if(r.ok){setGrant(null);setMessage(ar?'تم إلغاء التصريح.':'Review access revoked.');}}).finally(()=>setBusy(false));}}>{ar?'إلغاء التصريح':'Revoke review access'}</Button></>}
 </section>;
}

'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {useDemo} from '@/lib/demo-state';
import {WorkspaceShell} from './workspace-shell';
import {Button,Notice} from './ui';
import {InstagramOwnerConnection} from './instagram-owner-connection';
import {loadInstagramInboxPage,loadInstagramThreadPage,markInstagramThreadRead} from '@/lib/instagram/inbox-actions';
import {loadInstagramReply,loadInstagramSendReadiness,saveInstagramReply,sendSavedInstagramReply} from '@/lib/instagram/manual-actions';
import type {InstagramInboxPage,InstagramThreadPage} from '@/lib/instagram/inbox-contracts';
type Saved=Extract<Awaited<ReturnType<typeof loadInstagramReply>>,{ok:true}>['data'];
const uuid=(v:string|null)=>v&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)?v.toLowerCase():null;
const labels:Record<string,[string,string]>={
 REPLY_PERMISSION_REQUIRED:['You need permission to reply.','تحتاج إلى صلاحية الرد.'],
 ENTITLEMENT_DENIED:['A verified active Live subscription is required.','يلزم اشتراك فعّال موثّق في البيئة الحقيقية.'],
 INSTALLED_SECRET_UNVERIFIED:['Signed Instagram receiving is awaiting setup verification.','استقبال إنستغرام الموثّق ينتظر التحقق من الإعداد.'],
 TIMESTAMP_CONTRACT_UNVERIFIED:['The Instagram message-time contract is awaiting verification.','توقيت رسائل إنستغرام ينتظر التحقق.'],
 WINDOW_CLOSED:['No verified inbound message opens the reply window.','لا توجد رسالة واردة موثّقة تفتح نافذة الرد.'],
 ROLLOUT_DISABLED:['Instagram sending is awaiting activation approval.','إرسال إنستغرام ينتظر الموافقة على التفعيل.'],
 SCHEMA_UNAVAILABLE:['Instagram storage is awaiting installation.','تخزين إنستغرام ينتظر التثبيت.'],
 WORKSPACE_CHANGED:['The workspace changed. Refresh this page.','تغيّرت مساحة العمل. حدّث الصفحة.'],
 RECONCILIATION_REQUIRED:['The previous send is unresolved. Do not resend it.','لم تُحسم نتيجة الإرسال السابق. لا تعِد إرساله.'],
 BINDING_CHANGED:['The connected Instagram account changed. Refresh this page.','تغيّر حساب إنستغرام المرتبط. حدّث الصفحة.'],
 SEND_DISABLED:['Instagram sending is awaiting activation approval.','إرسال إنستغرام ينتظر الموافقة على التفعيل.'],
 FORBIDDEN:['You do not have access to this Instagram conversation.','ليست لديك صلاحية لهذه المحادثة.'],
 CONFLICT:['This saved reply differs from your current text. Reload the saved reply.','هذا الرد المحفوظ يختلف عن النص الحالي. أعد تحميل الرد.'],
 INVALID_INPUT:['Enter a reply of at most 1,000 UTF-8 bytes.','أدخل ردًا لا يتجاوز ١٬٠٠٠ بايت بترميز UTF-8.'],
};
export function InstagramInbox({companyId,owner=false,companyInSetup=false,callbackResult,callbackDiagnostic}:{companyId:string|null;owner?:boolean;companyInSetup?:boolean;callbackResult?:string;callbackDiagnostic?:unknown}){
 const {locale}=useDemo(),ar=locale==='ar',router=useRouter(),params=useSearchParams();
 const conversationId=uuid(params.get('thread')),intentId=uuid(params.get('intent'));
 const viewKey=`${companyId}:${conversationId}:${intentId}`;
 const epoch=useRef(0),reservation=useRef<{id:string;text:string}|null>(null);
 const [displayKey,setDisplayKey]=useState(viewKey),[reserved,setReserved]=useState(false),[refresh,setRefresh]=useState(0);
 const [inbox,setInbox]=useState<InstagramInboxPage|null>(null),[thread,setThread]=useState<InstagramThreadPage|null>(null);
 const [saved,setSaved]=useState<Saved|null>(null),[text,setText]=useState(''),[blockers,setBlockers]=useState<string[]>([]);
 const [readinessVerified,setReadinessVerified]=useState(false);
 const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const notice=(code:string)=>labels[code]?.[ar?1:0]??(ar?'تعذّر إكمال الطلب. حاول تحديث الصفحة.':'The request could not be completed. Refresh this page.');
 useEffect(()=>{
  const fence=epoch,current=++fence.current;
  void(async()=>{try{
   await Promise.resolve();if(current!==fence.current)return;
   reservation.current=null;setReserved(false);setDisplayKey(viewKey);setInbox(null);setThread(null);setSaved(null);setText('');setError(null);setBlockers([]);setReadinessVerified(false);setBusy(false);setLoading(true);
   if(!companyId)return;
   const page=await loadInstagramInboxPage({companyId});if(current!==epoch.current)return;
   if(!page.ok){setError(page.code);return;}setInbox(page.data);
   if(!conversationId)return;
   const loaded=await loadInstagramThreadPage({companyId,conversationId});if(current!==epoch.current)return;
   if(!loaded.ok){setError(loaded.code);return;}setThread(loaded.data);
   const readiness=await loadInstagramSendReadiness({companyId,conversationId});if(current!==epoch.current)return;
   if(readiness.ok){setBlockers(readiness.data.blockers);setReadinessVerified(true);}else setError(readiness.code);
   if(intentId){const r=await loadInstagramReply({companyId,conversationId,intentId});if(current!==epoch.current)return;
    if(r.ok){setSaved(r.data);setText(r.data.text);}else setError(r.code);}
  }catch{if(current===epoch.current)setError('UNAVAILABLE');}finally{if(current===epoch.current)setLoading(false);}})();
  return()=>{fence.current++;};
 },[companyId,conversationId,intentId,viewKey,refresh]);
 // Acknowledge only after the latest returned page has actually rendered.
 useEffect(()=>{if(!thread?.readReceipt||!companyId)return;const current=epoch.current;
  void markInstagramThreadRead({companyId,conversationId:thread.conversationId,readReceipt:thread.readReceipt}).then(r=>{if(current===epoch.current&&!r.ok)setError(r.code);}).catch(()=>{if(current===epoch.current)setError('UNAVAILABLE');});
 },[thread,companyId]);
 function select(id:string){epoch.current++;reservation.current=null;setReserved(false);setThread(null);setSaved(null);setText('');setLoading(true);setError(null);if(id===conversationId&&!intentId)setRefresh(n=>n+1);router.push(`/app/instagram?thread=${encodeURIComponent(id)}`);}
 async function save(){
  if(!companyId||!conversationId||busy||loading||!thread||saved||!text)return;
  if(new TextEncoder().encode(text).byteLength>1000||text.includes('\0')){setError('INVALID_INPUT');return;}
  const current=epoch.current;const captured=reservation.current??{id:crypto.randomUUID(),text};reservation.current=captured;setReserved(true);setBusy(true);setError(null);
  try{const r=await saveInstagramReply({companyId,conversationId,intentId:captured.id,text:captured.text});if(current!==epoch.current)return;
   if(!r.ok){if(r.code!=='UNAVAILABLE'){reservation.current=null;setReserved(false);}setError(r.code);return;}setSaved(r.data);setText(r.data.text);reservation.current=null;setReserved(false);
   router.replace(`/app/instagram?thread=${encodeURIComponent(conversationId)}&intent=${encodeURIComponent(captured.id)}`);
  }catch{if(current===epoch.current)setError('UNAVAILABLE');}finally{if(current===epoch.current)setBusy(false);}
 }
 async function send(){
  if(!companyId||!conversationId||busy||loading||!readinessVerified||!saved||saved.state!=='ready'||blockers.length)return;
  const current=epoch.current;setBusy(true);setError(null);
  try{const r=await sendSavedInstagramReply({companyId,conversationId,intentId:saved.binding.intentId});if(current!==epoch.current)return;
   if(!r.ok){setError(r.code);return;}setSaved({...r.data,text:saved.text});
  }catch{if(current===epoch.current)setError('UNAVAILABLE');}finally{if(current===epoch.current)setBusy(false);}
 }
 async function more(kind:'inbox'|'thread'){
  if(!companyId||busy||loading)return;
  const cursor=kind==='inbox'?inbox?.nextCursor:thread?.nextCursor;if(!cursor)return;
  const current=epoch.current;setBusy(true);setError(null);
  try{if(kind==='inbox'){
   const r=await loadInstagramInboxPage({companyId,cursor});if(current!==epoch.current)return;
   if(!r.ok){setError(r.code);return;}
   setInbox(old=>old?{...r.data,conversations:[...old.conversations,...r.data.conversations.filter(c=>!old.conversations.some(o=>o.id===c.id))]}:r.data);
  }else if(conversationId){
   const r=await loadInstagramThreadPage({companyId,conversationId,cursor});if(current!==epoch.current)return;
   if(!r.ok){setError(r.code);return;}
   // Older-page loading cannot acknowledge the latest inbound boundary again.
   setThread(old=>old?{...r.data,readReceipt:null,messages:[...old.messages,...r.data.messages.filter(m=>!old.messages.some(o=>o.id===m.id))]}:{...r.data,readReceipt:null});
  }}catch{if(current===epoch.current)setError('UNAVAILABLE');}finally{if(current===epoch.current)setBusy(false);}
 }
 return <WorkspaceShell title={ar?'محادثات إنستغرام':'Instagram conversations'}>
  {companyId&&owner&&<InstagramOwnerConnection key={companyId} companyId={companyId} ar={ar} callbackResult={callbackResult} callbackDiagnostic={callbackDiagnostic}/>}
  {!companyId?<Notice>{ar?'اختر مساحة عمل لعرض إنستغرام.':'Choose a workspace to view Instagram.'}</Notice>:displayKey!==viewKey?<p aria-busy="true">{ar?'جارٍ التحميل…':'Loading…'}</p>:<>
   {error&&<Notice tone="error">{error==='FORBIDDEN'&&owner&&companyInSetup&&!conversationId
    ?(ar?'محادثات إنستغرام غير متاحة أثناء تجهيز الشركة. يلزم اعتماد تفعيل الشركة قبل عرض المحادثات.':'Instagram conversations are unavailable while the company is in setup. Company activation must be approved before viewing conversations.')
    :notice(error)}</Notice>}
   {loading&&<p aria-busy="true">{ar?'جارٍ التحميل…':'Loading…'}</p>}
   <Button onClick={()=>{epoch.current++;setReadinessVerified(false);setRefresh(n=>n+1);}} disabled={busy||loading||reserved}>{ar?'تحديث المحادثات':'Refresh conversations'}</Button>
   {!loading&&inbox&&inbox.conversations.length===0&&<p>{ar?'لا توجد محادثات إنستغرام بعد.':'No Instagram conversations yet.'}</p>}
   <nav aria-label={ar?'محادثات إنستغرام':'Instagram threads'}>{inbox?.conversations.map(c=><button key={c.id} type="button" onClick={()=>select(c.id)} aria-current={conversationId===c.id?'page':undefined}>{c.counterpartyId} · {c.unreadCount}</button>)}</nav>
   {inbox?.hasMore&&<Button onClick={()=>void more('inbox')} disabled={busy||loading}>{ar?'محادثات إضافية':'More conversations'}</Button>}
   {thread&&<section aria-label={ar?'المحادثة':'Conversation'}>
    <ol>{[...thread.messages].reverse().map(m=><li key={m.id}>{m.direction==='inbound'?(ar?'وارد: ':'Inbound: '):(ar?'صادر: ':'Outbound: ')}{m.content.kind==='text'?m.content.text:(ar?'رسالة غير نصية':'Non-text message')}</li>)}</ol>
    {thread.hasMore&&<Button onClick={()=>void more('thread')} disabled={busy||loading}>{ar?'رسائل أقدم':'Older messages'}</Button>}
    {blockers.length>0&&<Notice>{blockers.map(b=><p key={b}>{notice(b)}</p>)}</Notice>}
    <label>{ar?'نص الرد':'Reply text'}<textarea value={text} readOnly={!!saved||reserved} disabled={busy||loading} onChange={e=>setText(e.target.value)}/></label>
    {!saved?<Button onClick={()=>void save()} disabled={busy||loading||!text||blockers.includes('REPLY_PERMISSION_REQUIRED')}>{ar?'حفظ الرد':'Save reply'}</Button>:<>
     <p role="status">{saved.state==='accepted'?(ar?'قبِل إنستغرام الرسالة؛ لم يتأكد التسليم.':'Instagram accepted the message; delivery is unconfirmed.'):saved.state==='unknown'||saved.state==='claimed'?notice('RECONCILIATION_REQUIRED'):(ar?'الرد محفوظ.':'Reply saved.')}</p>
     <Button onClick={()=>void send()} disabled={busy||loading||!readinessVerified||saved.state!=='ready'||blockers.length>0}>{ar?'إرسال الرد المحفوظ':'Send saved reply'}</Button>
     <Button onClick={()=>select(conversationId!)} disabled={busy||saved.state==='unknown'||saved.state==='claimed'}>{ar?'رد جديد':'New reply'}</Button>
    </>}
   </section>}
  </>}
 </WorkspaceShell>;
}

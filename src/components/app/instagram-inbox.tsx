'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {useDemo} from '@/lib/demo-state';
import {captureTranscriptPosition,restoreTranscriptPosition,type TranscriptPosition} from './transcript-position';
import {ChannelBadge} from './channel-badge';
import {ConversationDetailsPanel} from './conversation-details-panel';
import {WorkspaceShell} from './workspace-shell';
import {Button,Notice} from './ui';
import {InstagramOwnerConnection} from './instagram-owner-connection';
import {ChannelAIDraft} from './channel-ai-draft';
import {ChannelReviewStatus} from './channel-review';
import {loadInstagramInboxPage,loadInstagramThreadPage,markInstagramThreadRead,assignInstagramConversation} from '@/lib/instagram/inbox-actions';
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
export function InstagramInbox({companyId,owner=false,companyInSetup=false,reviewMode=false,callbackResult,callbackDiagnostic,embedded=false,selectedConversationId,onSelectConversation,refreshVersion=0,canAssign=false}:{canAssign?:boolean;refreshVersion?:number;embedded?:boolean;selectedConversationId?:string|null;onSelectConversation?:(id:string|null,intentId?:string)=>void;companyId:string|null;owner?:boolean;companyInSetup?:boolean;reviewMode?:boolean;callbackResult?:string;callbackDiagnostic?:unknown}){
 const {locale}=useDemo(),ar=locale==='ar',router=useRouter(),params=useSearchParams();
 const conversationId=embedded?selectedConversationId??null:uuid(params.get('thread')),intentId=uuid(params.get('intent'));
 const draftKey=`${companyId}:${conversationId}`;
 const localIntents=useRef<Record<string,string>>({});
 const viewKey=`${companyId}:${conversationId}:${intentId}`;
 const scrollPositions=useRef<Record<string,TranscriptPosition>>({}),loadedView=useRef<string|null>(null);
 const epoch=useRef(0),reservations=useRef<Record<string,{id:string;text:string}>>({});
 const [displayKey,setDisplayKey]=useState(viewKey),[reserved,setReserved]=useState(false),[refresh,setRefresh]=useState(0);
 const [inbox,setInbox]=useState<InstagramInboxPage|null>(null),[thread,setThread]=useState<InstagramThreadPage|null>(null);
 const [saved,setSaved]=useState<Saved|null>(null),[drafts,setDrafts]=useState<Record<string,string>>({}),[blockers,setBlockers]=useState<string[]>([]);
 const text=drafts[draftKey]??'',setText=(value:string)=>setDrafts(old=>({...old,[draftKey]:value}));
 const [readinessVerified,setReadinessVerified]=useState(false);
 const [detailsOpen,setDetailsOpen]=useState(false);
 const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const notice=(code:string)=>labels[code]?.[ar?1:0]??(ar?'تعذّر إكمال الطلب. حاول تحديث الصفحة.':'The request could not be completed. Refresh this page.');
 useEffect(()=>{
  const fence=epoch,current=++fence.current;
  void(async()=>{try{
   await Promise.resolve();if(current!==fence.current)return;
   const changed=loadedView.current!==viewKey;loadedView.current=viewKey;
   setReserved(Boolean(reservations.current[draftKey]));setDisplayKey(viewKey);if(changed){setDetailsOpen(false);setInbox(null);setThread(null);setSaved(null);}setError(null);setBlockers([]);setReadinessVerified(false);setBusy(false);setLoading(true);
   if(!companyId)return;
   // UnifiedInbox owns the list and its scope checks. This mounted pane owns
   // only the selected thread; hidden draft storage must not trigger list reads.
   if(!embedded){
    const page=await loadInstagramInboxPage({companyId});if(current!==epoch.current)return;
    if(!page.ok){setError(page.code);return;}setInbox(page.data);
   }
   if(!conversationId)return;
   const loaded=await loadInstagramThreadPage({companyId,conversationId});if(current!==epoch.current)return;
   if(!loaded.ok){setError(loaded.code);return;}setThread(old=>old?.companyId===loaded.data.companyId&&old.conversationId===loaded.data.conversationId?{...loaded.data,messages:[...loaded.data.messages,...old.messages.filter(m=>!loaded.data.messages.some(next=>next.id===m.id))],hasMore:old.hasMore,nextCursor:old.nextCursor}:loaded.data);
   const readiness=await loadInstagramSendReadiness({companyId,conversationId});if(current!==epoch.current)return;
   if(readiness.ok){setBlockers(readiness.data.blockers);setReadinessVerified(true);}else setError(readiness.code);
   const savedIntent=intentId??localIntents.current[draftKey];
   if(savedIntent){const r=await loadInstagramReply({companyId,conversationId,intentId:savedIntent});if(current!==epoch.current)return;
    if(r.ok){setSaved(r.data);setDrafts(old=>({...old,[draftKey]:r.data.text}));delete reservations.current[draftKey];setReserved(false);}else setError(r.code);}
  }catch{if(current===epoch.current)setError('UNAVAILABLE');}finally{if(current===epoch.current)setLoading(false);}})();
  return()=>{fence.current++;};
 },[companyId,conversationId,intentId,viewKey,draftKey,refresh,refreshVersion,embedded]);
 // Acknowledge only after the latest returned page has actually rendered.
 useEffect(()=>{if(!thread?.readReceipt||!companyId)return;const current=epoch.current;
  void markInstagramThreadRead({companyId,conversationId:thread.conversationId,readReceipt:thread.readReceipt}).then(r=>{if(current===epoch.current&&!r.ok)setError(r.code);}).catch(()=>{if(current===epoch.current)setError('UNAVAILABLE');});
 },[thread,companyId]);
 function select(id:string){epoch.current++;setReserved(false);setThread(null);setSaved(null);setLoading(true);setError(null);if(id===conversationId&&!intentId)setRefresh(n=>n+1);if(embedded)onSelectConversation?.(id);else router.push(`/app/instagram?thread=${encodeURIComponent(id)}`);}
 async function save(){
  if(!companyId||!conversationId||busy||loading||!thread||saved||!text)return;
  if(new TextEncoder().encode(text).byteLength>1000||text.includes('\0')){setError('INVALID_INPUT');return;}
  const current=epoch.current;const captured=reservations.current[draftKey]??{id:crypto.randomUUID(),text};reservations.current[draftKey]=captured;setReserved(true);setBusy(true);setError(null);
  localIntents.current[draftKey]=captured.id;
  try{const r=await saveInstagramReply({companyId,conversationId,intentId:captured.id,text:captured.text});if(current!==epoch.current)return;
   if(!r.ok){if(r.code!=='UNAVAILABLE'){delete reservations.current[draftKey];delete localIntents.current[draftKey];setReserved(false);}setError(r.code);return;}setSaved(r.data);setText(r.data.text);delete reservations.current[draftKey];setReserved(false);
   localIntents.current[draftKey]=captured.id;
   if(embedded)onSelectConversation?.(conversationId,captured.id);else router.replace(`/app/instagram?thread=${encodeURIComponent(conversationId)}&intent=${encodeURIComponent(captured.id)}`);
  }catch{if(current===epoch.current)setError('UNAVAILABLE');}finally{if(current===epoch.current)setBusy(false);}
 }
 async function send(){
  if(!companyId||!conversationId||busy||loading||!readinessVerified||!saved||saved.state!=='ready'||blockers.length)return;
  const current=epoch.current;setBusy(true);setError(null);
  try{const r=await sendSavedInstagramReply({companyId,conversationId,intentId:saved.binding.intentId});if(current!==epoch.current)return;
   if(!r.ok){setError(r.code);return;}setSaved({...r.data,text:saved.text});
  }catch{if(current===epoch.current)setError('UNAVAILABLE');}finally{if(current===epoch.current)setBusy(false);}
 }
 async function assign(assignedTo:string|null){
  if(!companyId||!thread||!canAssign||busy||loading)return;
  const current=epoch.current;setBusy(true);setError(null);
  try{const result=await assignInstagramConversation({companyId,conversationId:thread.conversationId,assignedTo,expectedRevision:thread.conversation.revision});
   if(current!==epoch.current)return;if(!result.ok){setError(result.code);return;}
   setThread(old=>old?{...old,conversation:{...old.conversation,assignedTo:result.data.assignedTo,revision:result.data.revision}}:old);
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
 return <WorkspaceShell embedded={embedded} title={ar?'محادثات إنستغرام':'Instagram conversations'}>
  {reviewMode&&<Notice>{ar?'مساحة مراجعة ميتا · اختبار بحساب المراجعة':'Meta review workspace · test account'}</Notice>}
  {reviewMode&&companyId&&owner&&<ChannelReviewStatus key={companyId} companyId={companyId} channel="instagram"/>}
  {!embedded&&companyId&&owner&&<InstagramOwnerConnection key={companyId} companyId={companyId} ar={ar} callbackResult={callbackResult} callbackDiagnostic={callbackDiagnostic}/>}
  {!companyId?<Notice>{ar?'اختر مساحة عمل لعرض إنستغرام.':'Choose a workspace to view Instagram.'}</Notice>:displayKey!==viewKey?<p aria-busy="true">{ar?'جارٍ التحميل…':'Loading…'}</p>:<>
   {error&&<Notice tone="error">{error==='FORBIDDEN'&&owner&&companyInSetup&&!conversationId
    ?(ar?'محادثات إنستغرام غير متاحة أثناء تجهيز الشركة. يلزم اعتماد تفعيل الشركة قبل عرض المحادثات.':'Instagram conversations are unavailable while the company is in setup. Company activation must be approved before viewing conversations.')
    :notice(error)}</Notice>}
   {loading&&<p aria-busy="true">{ar?'جارٍ التحميل…':'Loading…'}</p>}
   {!embedded&&<Button onClick={()=>{epoch.current++;setReadinessVerified(false);setRefresh(n=>n+1);}} disabled={busy||loading||reserved}>{ar?'تحديث المحادثات':'Refresh conversations'}</Button>}
   {!loading&&!error&&inbox&&inbox.conversations.length===0&&<p>{ar?'لا توجد محادثات إنستغرام بعد.':'No Instagram conversations yet.'}</p>}
   <nav data-inbox-list="true" hidden={embedded} aria-label={ar?'محادثات إنستغرام':'Instagram threads'}>{inbox?.conversations.map(c=><button key={c.id} type="button" onClick={()=>select(c.id)} aria-current={conversationId===c.id?'page':undefined}>{c.counterpartyId} · {c.unreadCount}</button>)}</nav>
   {!embedded&&inbox?.hasMore&&<Button onClick={()=>void more('inbox')} disabled={busy||loading}>{ar?'محادثات إضافية':'More conversations'}</Button>}
   {thread&&<div className="ig-conversation-layout"><section data-channel-inbox="instagram" aria-label={ar?'المحادثة':'Conversation'}>
    <header className="ig-thread-header"><div><h2 dir="auto">{thread.conversation.counterpartyId}</h2><ChannelBadge channel="instagram" ar={ar}/></div><p>{ar?'الإسناد: ':'Assigned: '}{thread.conversation.assignedTo?(ar?'موظف':'Staff'):(ar?'غير مسندة':'Unassigned')}</p><Button variant="ghost" data-details-toggle="true" aria-expanded={detailsOpen} aria-controls="instagram-details" onClick={()=>setDetailsOpen(true)}>{ar?'التفاصيل':'Details'}</Button></header>
    {canAssign&&<div className="flex flex-wrap gap-2 px-4 py-2"><Button variant="secondary" disabled={busy||loading} onClick={()=>void assign(thread.actorId)}>{ar?'إسناد إليّ':'Assign to me'}</Button>{thread.conversation.assignedTo&&<Button variant="ghost" disabled={busy||loading} onClick={()=>void assign(null)}>{ar?'إزالة الإسناد':'Remove assignment'}</Button>}</div>}
    <ol data-transcript="true" ref={node=>{if(node)restoreTranscriptPosition(node,scrollPositions.current[draftKey]);}} onScroll={event=>{scrollPositions.current[draftKey]=captureTranscriptPosition(event.currentTarget);}}>{[...thread.messages].sort((a,b)=>BigInt(a.arrivalSequence)<BigInt(b.arrivalSequence)?-1:1).map(m=><li key={m.id} data-message-id={m.id} data-direction={m.direction}><span className="ig-message-source">{m.direction==='inbound'?(ar?'العميل':'Customer'):(ar?'رد صادر · الهوية غير متاحة':'Outbound reply · identity unavailable')}</span><p dir="auto">{m.content.kind==='text'?m.content.text:(ar?'رسالة غير نصية':'Non-text message')}</p><time dateTime={m.receivedAt}>{new Date(m.receivedAt).toLocaleTimeString(ar?'ar-OM':'en-GB',{hour:'2-digit',minute:'2-digit'})}</time></li>)}</ol>
    {thread.hasMore&&<Button onClick={()=>void more('thread')} disabled={busy||loading}>{ar?'رسائل أقدم':'Older messages'}</Button>}
    {blockers.length>0&&<Notice>{blockers.map(b=><p key={b}>{notice(b)}</p>)}</Notice>}
    {!reviewMode&&<ChannelAIDraft key={`${companyId}:${conversationId}:${thread.messages[0]?.id}:${thread.messages.at(-1)?.id}:${thread.conversation.revision}`} companyId={companyId} channel="instagram" conversationId={thread.conversationId} ar={ar} disabled={busy||loading||!!saved||reserved} onUse={setText}/>}
    <ChannelBadge channel="instagram" ar={ar}/><label>{ar?'نص الرد':'Reply text'}<textarea value={text} readOnly={!!saved||reserved} disabled={busy||loading} onChange={e=>setText(e.target.value)}/></label>
    {!saved?<Button onClick={()=>void save()} disabled={busy||loading||!text||blockers.includes('REPLY_PERMISSION_REQUIRED')}>{ar?'حفظ الرد':'Save reply'}</Button>:<>
     <p role="status">{saved.state==='accepted'?(ar?'قبِل إنستغرام الرسالة؛ لم يتأكد التسليم.':'Instagram accepted the message; delivery is unconfirmed.'):saved.state==='unknown'||saved.state==='claimed'?notice('RECONCILIATION_REQUIRED'):(ar?'الرد محفوظ.':'Reply saved.')}</p>
     <Button onClick={()=>void send()} disabled={busy||loading||!readinessVerified||saved.state!=='ready'||blockers.length>0}>{ar?'إرسال الرد المحفوظ':'Send saved reply'}</Button>
     <Button onClick={()=>{delete localIntents.current[draftKey];setText('');select(conversationId!);}} disabled={busy||saved.state==='unknown'||saved.state==='claimed'}>{ar?'رد جديد':'New reply'}</Button>
    </>}
   </section><ConversationDetailsPanel id="instagram-details" title={ar?'تفاصيل المحادثة':'Conversation details'} open={detailsOpen} onClose={()=>setDetailsOpen(false)}>
    <ChannelBadge channel="instagram" ar={ar}/><dl><dt>{ar?'معرّف الطرف':'Participant ID'}</dt><dd dir="ltr">{thread.conversation.counterpartyId}</dd><dt>{ar?'حساب النشاط':'Business account ID'}</dt><dd dir="ltr">{thread.conversation.accountId}</dd><dt>{ar?'الإسناد':'Assignment'}</dt><dd dir="auto">{thread.conversation.assignedTo??(ar?'غير مسندة':'Unassigned')}</dd><dt>{ar?'آخر رسالة واردة':'Latest inbound message'}</dt><dd>{thread.conversation.lastReceivedAt?new Date(thread.conversation.lastReceivedAt).toLocaleString(ar?'ar-OM':'en-GB'):'—'}</dd></dl>
    {owner&&<a href="/app/instagram">{ar?'حالة ربط إنستجرام':'Instagram connection status'}</a>}
   </ConversationDetailsPanel></div>}
  </>}
 </WorkspaceShell>;
}

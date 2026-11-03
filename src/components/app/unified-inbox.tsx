'use client';
import {useCallback,useEffect,useMemo,useRef,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {useLocalSearchParams} from '@/lib/navigation/use-local-search-params';
import Link from 'next/link';
import {useDemo} from '@/lib/demo-state';
import {fetchServiceInbox,type ServiceInboxSnapshot} from '@/lib/customer/service-inbox-read';
import {selectedIncludedChannels} from '@/lib/channels/contract';
import {refreshWhatsappInboxPage} from '@/lib/whatsapp/inbox-actions';
import {loadInstagramInboxPage} from '@/lib/instagram/inbox-actions';
import {mergeInboxPageRows,matchesUnifiedInboxFilter} from './conversations-inbox';
import {WorkspaceShell} from './workspace-shell';
import {ConversationsPage} from './conversations';
import {InstagramInbox} from './instagram-inbox';
import {Button,EmptyState,Notice,useAppCopy} from './ui';
import {ChannelBadge} from './channel-badge';
import {CompanyInboxRealtime,type InboxRealtimeEvent} from './branch-inbox-realtime';
import {inboxHref,inboxRows,type InboxChannel} from './inbox-presentation';
import styles from './unified-inbox.module.css';
import {useOptionalAccountSession} from './account-chrome';
import {useWorkspaceBootstrap} from './workspace-bootstrap';
type Snapshot=ServiceInboxSnapshot;
export function UnifiedInbox(props:{initial:Snapshot;waReview?:boolean;igReview?:boolean}) {
 const account=useOptionalAccountSession(),workspace=useWorkspaceBootstrap();
 const {initial}=props;
 const mismatch=initial.ok&&((account&&(account.status!=='ready'||account.identity?.userId!==initial.actorId))||(workspace&&(workspace.identity.userId!==initial.actorId||workspace.workspace.selectedCompanyId!==initial.companyId)));
 const unavailable=initial.ok&&((!initial.wa.ok&&initial.wa.code==='UNAVAILABLE')||(!initial.ig.ok&&initial.ig.code==='UNAVAILABLE'));
 const admitted=mismatch?{ok:false as const,code:'SCOPE_CHANGED' as const}:unavailable?{ok:false as const,code:'UNAVAILABLE' as const}:initial;
 const key=admitted.ok?`${admitted.companyId}:${admitted.actorId}:${account?.boundaryFingerprint??''}:${admitted.waAllowed}:${admitted.igAllowed}:${admitted.wa.ok?admitted.wa.page.membershipFingerprint:''}:${admitted.ig.ok?admitted.ig.data.conversationScope:''}`:admitted.code;
 return <ScopedUnifiedInbox key={key} {...props} initial={admitted}/>;
}
function ScopedUnifiedInbox({initial,waReview=false,igReview=false}:{initial:Snapshot;waReview?:boolean;igReview?:boolean}) {
 const {locale}=useDemo(),ar=locale==='ar',router=useRouter(),copy=useAppCopy();
 // Next's route state can wait behind a pending Server Action. Selection is
 // urgent local UI state; the URL remains its source for Back/Forward and links.
 const [params,navigateLocally]=useLocalSearchParams();
 const [isNavigating,startTransition]=useTransition();
 const [snapshot,setSnapshot]=useState(initial),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(false);
 const [retained,setRetained]=useState<Extract<Snapshot,{ok:true}>|null>(initial.ok?initial:null);
 const [refreshVersion,setRefreshVersion]=useState(0),[revoked,setRevoked]=useState(false);
 const [moreLoading,setMoreLoading]=useState<InboxChannel|null>(null);
 const epoch=useRef(0),busy=useRef(false),mounted=useRef(true);
 const live=useRef(false),queuedRefresh=useRef(false),eventTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const accessRevoked=useRef(false);
 const refreshRef=useRef<()=>Promise<void>>(async()=>{});
 const [query,setQuery]=useState('');
 const expected=initial.ok?`${initial.companyId}:${initial.actorId}`:null;
 const refresh=useCallback(async()=>{
  if(expected===null||accessRevoked.current)return;
  if(busy.current){queuedRefresh.current=true;return;}
  queuedRefresh.current=false;busy.current=true;const request=++epoch.current;setRefreshing(true);
  try{const [companyId,actorId]=expected.split(':');const result=await fetchServiceInbox({companyId:companyId!,actorId:actorId!});if(!mounted.current||epoch.current!==request)return;
   if(result.ok&&`${result.companyId}:${result.actorId}`!==expected){setRetained(null);setSnapshot({ok:false,code:'SCOPE_CHANGED'});setError(true);return;}
   if(!result.ok){setRetained(null);setSnapshot(result);setError(true);return;}
   // Replace cached pages: stable identity is not proof of old assignments.
   if((!result.wa.ok&&result.wa.code==='UNAVAILABLE')||(!result.ig.ok&&result.ig.code==='UNAVAILABLE')){setRetained(null);setSnapshot({ok:false,code:'UNAVAILABLE'});setError(true);return;}
   setSnapshot(result);setRetained(result);setRefreshVersion(n=>n+1);setError(false);
  }catch{if(mounted.current&&epoch.current===request){setRetained(null);setSnapshot({ok:false,code:'UNAVAILABLE'});setError(true);}}
  finally{busy.current=false;if(mounted.current&&epoch.current===request){setRefreshing(false);if(queuedRefresh.current&&document.visibilityState==='visible')void refreshRef.current();}}
 },[expected]);
 useEffect(()=>{refreshRef.current=refresh;},[refresh]);
 const onInboxEvent=useCallback((event:InboxRealtimeEvent)=>{
  if(accessRevoked.current)return;
  if(event.type==='unavailable'){live.current=false;queuedRefresh.current=false;if(eventTimer.current!==null)clearTimeout(eventTimer.current);eventTimer.current=null;epoch.current++;setRefreshing(false);setMoreLoading(null);setRetained(null);setSnapshot({ok:false,code:'UNAVAILABLE'});setError(true);return;}
  if(event.type==='revoked'){accessRevoked.current=true;setRevoked(true);live.current=false;queuedRefresh.current=false;if(eventTimer.current!==null)clearTimeout(eventTimer.current);eventTimer.current=null;epoch.current++;setRetained(null);setSnapshot({ok:false,code:'SCOPE_CHANGED'});setError(true);return;}
  if(event.type==='ready'||event.type==='reconnect')live.current=true;
  if(document.visibilityState!=='visible'){queuedRefresh.current=true;return;}
  if(eventTimer.current===null)eventTimer.current=setTimeout(()=>{eventTimer.current=null;if(mounted.current)void refreshRef.current();},250);
 },[]);
 useEffect(()=>{const fence=epoch;mounted.current=true;live.current=false;const timer=window.setInterval(()=>{if(!live.current&&document.visibilityState==='visible')void refresh();},30000);
  const onVisible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',onVisible);
  return()=>{mounted.current=false;fence.current++;queuedRefresh.current=false;if(eventTimer.current!==null)clearTimeout(eventTimer.current);eventTimer.current=null;window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};
 },[refresh]);
 const activeSource=snapshot.ok?snapshot:null;
 const readSuspended=!snapshot.ok;
 const channels:InboxChannel[]=activeSource&&activeSource.channelContract?(activeSource.channelContract.plan_entitlements.status==='UNCONFIGURED'
  ?([activeSource.waAllowed===true?'whatsapp':null,activeSource.igAllowed===true?'instagram':null].filter(Boolean) as InboxChannel[])
  :selectedIncludedChannels(activeSource.channelContract)):[];
 const requested=params.get('channel'),filter=channels.length===1?channels[0]:channels.includes(requested as InboxChannel)?requested as InboxChannel:'all';
 const source=params.get('source')==='instagram'||params.get('thread')?'instagram':'whatsapp';
 const selected=params.get(source==='instagram'?'thread':'c');
 const selectionValid=channels.includes(source)&&!!selected&&Boolean(activeSource?.ok&&(source==='whatsapp'?activeSource.waAllowed===true&&activeSource.wa.ok:activeSource.igAllowed===true&&activeSource.ig.ok));
 const rows=useMemo(()=>activeSource&&retained?inboxRows(activeSource.waAllowed===true&&activeSource.wa.ok&&retained.wa.ok?retained.wa.page.conversations:[],activeSource.igAllowed===true&&activeSource.ig.ok&&retained.ig.ok?retained.ig.data.conversations:[],ar):[],[activeSource,retained,ar]);
 const activeChannels=filter==='all'?channels:[filter];
 const activeRows=rows.filter(r=>filter==='all'||r.channel===filter);
 const requestedWorklist=params.get('filter');
 const worklist=requestedWorklist==='staff'||requestedWorklist==='noura'||requestedWorklist==='unread'||requestedWorklist==='resolved'?requestedWorklist:'all';
 const shown=activeRows.filter(r=>{
  if(worklist!=='all'){
   if(r.channel==='whatsapp'){
    const item=retained?.wa.ok?retained.wa.page.conversations.find(c=>c.id===r.id):undefined;
    if(!item||!matchesUnifiedInboxFilter(item,worklist))return false;
   }else if(worklist!=='unread'||r.unread===0)return false;
  }
  return !query||`${r.name} ${r.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
 });
 const anyActiveChannelFailed=activeChannels.some(channel=>{const result=channel==='whatsapp'?(snapshot.ok?snapshot.wa:retained?.wa):(snapshot.ok?snapshot.ig:retained?.ig);return !result||!result.ok;});
 const showEmpty=!shown.length&&(Boolean(query)||worklist!=='all'?(activeRows.length>0||!anyActiveChannelFailed):(!anyActiveChannelFailed&&activeRows.length===0));
 const filteredHref=(channel:InboxChannel|null,id:string|null,channelFilter:InboxChannel|'all'=filter)=>{const href=inboxHref(channel,id,channelFilter);return worklist==='all'?href:href+(href.includes('?')?'&':'?')+'filter='+worklist;};
 // Selection and filters consume the existing scoped snapshot. Native history
 // updates useSearchParams without rerunning the whole server inbox projection.
 // The selected pane still authorizes its thread read; explicit refresh stays live.
 const select=(channel:InboxChannel|null,id:string|null,intentId?:string)=>{const href=filteredHref(channel,id);navigateLocally(intentId?href+(href.includes("?")?"&":"?")+"intent="+encodeURIComponent(intentId):href);};
 const activeRow=rows.find(r=>r.channel===source&&r.id===selected);
 async function more(channel:InboxChannel){
  if(accessRevoked.current||moreLoading!==null||busy.current||!snapshot.ok||!retained)return;
  const wa=retained.wa,ig=retained.ig;
  const cursor=channel==='whatsapp'&&wa.ok?wa.page.nextCursor:channel==='instagram'&&ig.ok?ig.data.nextCursor:null;
  if(!cursor)return;busy.current=true;setMoreLoading(channel);const request=++epoch.current;
  try{if(channel==='whatsapp'&&wa.ok){const result=await refreshWhatsappInboxPage({companyId:retained.companyId,before:cursor});if(!mounted.current||request!==epoch.current)return;
   if(!result.ok){setRetained(null);setSnapshot({ok:false,code:result.code==='UNAVAILABLE'?'UNAVAILABLE':'SCOPE_CHANGED'});setError(true);return;}
   if(result.data.companyId!==retained.companyId||result.data.membershipFingerprint!==wa.page.membershipFingerprint){setRetained(null);setSnapshot({ok:false,code:'SCOPE_CHANGED'});setError(true);return;}
   setRetained(old=>old?.wa.ok?{...old,wa:{...old.wa,page:{...result.data,conversations:mergeInboxPageRows(old.wa.page.conversations,result.data.conversations)},conversations:mergeInboxPageRows(old.wa.page.conversations,result.data.conversations)}}:old);
  }else if(channel==='instagram'&&ig.ok){const result=await loadInstagramInboxPage({companyId:retained.companyId,cursor});if(!mounted.current||request!==epoch.current)return;
   if(!result.ok){setRetained(null);setSnapshot({ok:false,code:result.code==='UNAVAILABLE'?'UNAVAILABLE':'SCOPE_CHANGED'});setError(true);return;}
   if(result.data.companyId!==retained.companyId||result.data.actorId!==retained.actorId){setRetained(null);setSnapshot({ok:false,code:'SCOPE_CHANGED'});setError(true);return;}
   if(result.data.conversationScope!==ig.data.conversationScope){setRetained(null);setSnapshot({ok:false,code:'SCOPE_CHANGED'});setError(true);return;}
   setRetained(old=>old?.ig.ok?{...old,ig:{...old.ig,data:{...result.data,conversations:[...old.ig.data.conversations,...result.data.conversations.filter(c=>old.ig.ok&&!old.ig.data.conversations.some(existing=>existing.id===c.id))]}}}:old);
  }}catch{if(mounted.current&&request===epoch.current){setRetained(null);setSnapshot({ok:false,code:'UNAVAILABLE'});setError(true);}}
  finally{busy.current=false;if(mounted.current&&epoch.current===request){setMoreLoading(null);if(queuedRefresh.current&&document.visibilityState==='visible')void refreshRef.current();}}
 }
 return <WorkspaceShell immersive={selectionValid} title={ar?'المحادثات':'Conversations'} actions={revoked?<a href={`/app/conversations${params.toString()?`?${params.toString()}`:''}`} className="underline">{ar?'إعادة تحميل الصفحة للتحقق':'Reload page to verify'}</a>:<Button variant="secondary" busy={refreshing||isNavigating} disabled={moreLoading!==null} onClick={()=>{if(!initial.ok)startTransition(()=>{router.refresh();});else void refresh();}}>{ar?'تحديث':'Refresh'}</Button>}>
  {initial.ok&&<CompanyInboxRealtime key={`${initial.companyId}:${initial.actorId}`} companyId={initial.companyId} actorId={initial.actorId} ar={ar} onInboxEvent={onInboxEvent}/>}
  {error&&<Notice tone="error">{ar?'تعذّر التحقق من آخر تحديث. حدّث الصفحة قبل متابعة العمل.':'The latest update could not be verified. Refresh before continuing.'}</Notice>}
  {!snapshot.ok?<Notice tone={snapshot.code==='UNAVAILABLE'?'error':'warn'}>{snapshot.code==='NO_COMPANY'?(ar?'اختر نشاطًا من قائمة مساحة العمل.':'Choose a business from the workspace menu.'):snapshot.code==='FORBIDDEN'?<><strong>{copy.app.inboxAccessDeniedTitle}</strong><p>{copy.app.inboxAccessDeniedBody}</p></>:snapshot.code==='UNAVAILABLE'?copy.app.inboxLoadFailedBody:(ar?'تغيّرت الجلسة أو مساحة العمل. حدّث الصفحة للتحقق قبل المتابعة.':'The session or workspace changed. Refresh to verify before continuing.')} {snapshot.code==='UNAVAILABLE'&&<button type="button" className="underline ms-2 font-medium" disabled={refreshing||moreLoading!==null} onClick={()=>{if(!initial.ok)startTransition(()=>{router.refresh();});else void refresh();}}>{ar?'إعادة المحاولة':'Retry'}</button>} <Link href="/app/settings?tab=plan" className="underline ms-2">{ar?'الاشتراك والدعم':'Subscription and support'}</Link></Notice>:null}
  {activeSource&&retained&&<>
   {snapshot.ok&&snapshot.channelContract?.plan_entitlements.status==='UNCONFIGURED'&&<Notice tone="warn">{ar?'استحقاقات القنوات غير محددة (UNCONFIGURED). المعروض أدناه هو الوصول الحالي المتحقق منه؛ لا يعني أن القنوات مشمولة في الباقة.':'Channel entitlements are UNCONFIGURED. The channels below reflect verified existing access, not plan inclusion.'}</Notice>}
   {snapshot.ok&&!snapshot.channelContract&&<Notice tone="error">{ar?'تعذّر التحقق من إعداد استحقاقات القنوات. أعد التحديث.':'Channel entitlement configuration could not be verified. Refresh to retry.'}</Notice>}
   {snapshot.ok&&snapshot.channelContract&&snapshot.channelContract.plan_entitlements.status==='approved'&&!channels.length&&<Notice tone="warn">{ar?'يلزم تأكيد اختيار القنوات لهذه النسخة من الباقة. الاختيارات والسجل السابقان محفوظان.':'Channel selection needs confirmation for this plan version. Previous choices and history are retained.'}</Notice>}
   {(snapshot.ok&&(snapshot.waAllowed===null||snapshot.igAllowed===null))&&<Notice>{ar?'تعذّر التحقق من بعض صلاحيات القنوات.':'Some channel permissions could not be verified.'}</Notice>}
   {!channels.length&&snapshot.ok&&<EmptyState title={ar?'لا توجد قناة متاحة للقراءة':'No channel is available to read'} body={ar?'الاشتراك والربط والصلاحيات حالات مستقلة. راجع الإعدادات أو تواصل مع صاحب النشاط.':'Subscription, connection and permissions are separate. Review settings or contact your business owner.'} action={<Link href="/app/settings">{ar?'الإعدادات':'Settings'}</Link>}/>}<div className={styles.inbox} hidden={!channels.length} data-selected={selectionValid}>
    <section inert={readSuspended} className={styles.list} aria-label={ar?'قائمة المحادثات':'Conversation list'}>
     <header className={styles.listHeader}><h2>{ar?'صندوق الوارد':'Inbox'}</h2><p>{ar?'المحادثات المتاحة لهذا النشاط':'Available conversations for this business'}</p>
      {channels.length===2?<div className={styles.channelFilters} aria-label={ar?'القناة':'Channel'}>{(['all',...channels] as const).map(c=><button key={c} type="button" aria-pressed={filter===c} onClick={()=>navigateLocally(filteredHref(null,null,c))}>{c==='all'?(ar?'الكل':'All'):<ChannelBadge channel={c} ar={ar}/>}</button>)}</div>:<ChannelBadge channel={channels[0]??'whatsapp'} ar={ar}/>}
      {worklist!=='all'&&<p role="status">{worklist==='staff'?(ar?'تحتاج متابعة · واتساب':'Needs attention · WhatsApp'):worklist==='noura'?(ar?'الأتمتة مسموحة · واتساب':'Automation permitted · WhatsApp'):worklist==='unread'?(ar?'غير مقروءة':'Unread'):(ar?'محلولة · واتساب':'Resolved · WhatsApp')} <button type="button" className={styles.filterReset} onClick={()=>navigateLocally(inboxHref(null,null,filter))}>{ar?'مسح الفلتر':'Clear filter'}</button></p>}
      <label className={styles.search}>{ar?'بحث في المحادثات المحمّلة':'Search loaded conversations'}<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={ar?'الاسم أو آخر رسالة':'Name or latest message'}/></label>
     </header>
     <div className={styles.rows}>{channels.map(channel=>{const result=channel==='whatsapp'?snapshot.ok?snapshot.wa:retained.wa:snapshot.ok?snapshot.ig:retained.ig;if(result.ok)return null;const isForbidden=result.code==='FORBIDDEN';return <Notice key={channel} tone={isForbidden?'warn':'error'}><ChannelBadge channel={channel} ar={ar}/><p>{isForbidden?(ar?'القراءة غير متاحة. راجع صلاحيات القناة والاشتراك.':'Reading unavailable. Check channel permissions and subscription.'):(ar?'تعذّر تحميل القناة. أعد التحديث.':'This channel could not be loaded. Refresh to retry.')}{!isForbidden&&<button type="button" className="underline ms-2 font-medium" disabled={refreshing||moreLoading!==null} onClick={()=>void refresh()}>{ar?'إعادة المحاولة':'Retry'}</button>}</p></Notice>;})}
      {showEmpty&&<EmptyState title={query||worklist!=='all'?(ar?'لا نتائج في المحادثات المحمّلة':'No matches in loaded conversations'):(ar?'لا توجد محادثات بعد':'No conversations yet')} body={worklist!=='all'?(ar?'لا توجد محادثات تطابق البحث والفلتر في الصفحة المحمّلة. يمكنك مسح الفلتر أو تحميل المزيد.':'No conversations match this search and filter in the loaded page. Clear the filter or load more.'):query?(ar?'لم نجد أي محادثة تطابق بحثك في المحادثات المحمّلة.':'No conversations matched your search in loaded conversations.'):(ar?'تظهر الرسائل الواردة بعد ربط القناة والتحقق من استقبالها.':'Inbound messages appear after connecting and verifying the channel.')}/>}
      {shown.map(row=><button type="button" key={row.key} className={styles.row} aria-current={source===row.channel&&selected===row.id?'page':undefined} onClick={()=>select(row.channel,row.id)}><span className={styles.avatar} aria-hidden="true">{row.name.slice(0,1)}</span><span className={styles.rowBody}><span className={styles.rowHeading}><strong dir="auto">{row.name}</strong>{row.at>0&&<time dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleDateString(ar?'ar-OM':'en-GB',{day:'numeric',month:'short'})}</time>}</span><span className={styles.preview} dir="auto">{row.preview||'—'}</span><span className={styles.rowFooter}><ChannelBadge channel={row.channel} ar={ar}/>{row.unread>0&&<span className={styles.unread} aria-label={ar?`${row.unread} غير مقروءة`:`${row.unread} unread`}>{row.unread}</span>}</span></span></button>)}
     </div>
     <footer className={styles.listFooter}><p>{ar?'الترتيب حسب آخر نشاط بين الصفحات المحمّلة.':'Ordered by latest activity across loaded pages.'}</p><Link href={filter==='instagram'?'/app/instagram':'/app/settings?tab=whatsapp'}>{ar?'إعدادات الربط':'Connection settings'}</Link>
      {retained.wa.ok&&retained.wa.page.hasMore&&channels.includes('whatsapp')&&<Button variant="ghost" busy={moreLoading==='whatsapp'} disabled={refreshing||moreLoading!==null} onClick={()=>void more('whatsapp')}>{ar?'مزيد من واتساب':'More WhatsApp'}</Button>}
      {retained.ig.ok&&retained.ig.data.hasMore&&channels.includes('instagram')&&<Button variant="ghost" busy={moreLoading==='instagram'} disabled={refreshing||moreLoading!==null} onClick={()=>void more('instagram')}>{ar?'مزيد من إنستجرام':'More Instagram'}</Button>}
     </footer>
    </section>
    <div className={styles.thread} data-open={selectionValid} inert={readSuspended}>
     <fieldset disabled={readSuspended} style={{border:0,padding:0,margin:0,minWidth:0,display:'contents'}}>
     {selectionValid&&<div className={styles.threadToolbar}><button type="button" onClick={()=>select(null,null)} className={styles.back}>{ar?'الرجوع للمحادثات':'Back to conversations'}</button><Button variant="ghost" busy={refreshing} disabled={moreLoading!==null} onClick={()=>void refresh()} aria-label={ar?"تحديث المحادثة":"Refresh conversation"}>{ar?"تحديث":"Refresh"}</Button><ChannelBadge channel={source} ar={ar}/><span dir="auto">{activeRow?.name??(ar?'المحادثة':'Conversation')}</span></div>}
     {!selectionValid&&<div className={styles.welcome}><EmptyState title={ar?'اختر محادثة للبدء':'Choose a conversation'} body={ar?'كل رد يخرج عبر قناة المحادثة نفسها. بيانات الأنشطة والحسابات تبقى منفصلة.':'Each reply uses its conversation’s channel. Business and account histories remain separate.'}/></div>}
     {/* Keep native panes mounted: drafts and unresolved operation IDs survive channel navigation. */}
     {retained.wa.ok&&<div className={styles.pane} hidden={!selectionValid||source!=='whatsapp'} inert={!selectionValid||source!=='whatsapp'}><ConversationsPage key={retained.wa.page.membershipFingerprint} readSuspended={readSuspended} refreshVersion={refreshVersion} embedded selectedConversationId={selectionValid&&source==='whatsapp'?selected:null} onSelectConversation={id=>select('whatsapp',id)} inbox={retained.wa.conversations} page={retained.wa.page} meta={retained.wa.meta} reviewCompanyId={waReview?retained.companyId:undefined}/></div>}
     {retained.igAllowed===true&&<div className={styles.pane} hidden={!selectionValid||source!=='instagram'} inert={!selectionValid||source!=='instagram'}><InstagramInbox key={retained.ig.ok?retained.ig.data.conversationScope:'unverified'} readSuspended={readSuspended} canAssign={snapshot.ok&&snapshot.igAssignAllowed===true} refreshVersion={refreshVersion} embedded selectedConversationId={selectionValid&&source==='instagram'?selected:null} onSelectConversation={(id,intent)=>select('instagram',id,intent)} companyId={retained.companyId} owner={retained.owner} companyInSetup={retained.companyInSetup} reviewMode={igReview}/></div>}
     </fieldset>
    </div>
   </div>
  </>}
 </WorkspaceShell>;
}

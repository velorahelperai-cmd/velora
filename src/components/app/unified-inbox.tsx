'use client';
import {useCallback,useEffect,useMemo,useRef,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {useLocalSearchParams} from '@/lib/navigation/use-local-search-params';
import Link from 'next/link';
import {useDemo} from '@/lib/demo-state';
import {fetchInboxThread} from '@/lib/customer/inbox-thread-read';
import {fetchServiceInbox,type ServiceInboxSnapshot} from '@/lib/customer/service-inbox-read';
import {listInboxStars,runInboxExtension} from '@/lib/customer/inbox-extension-actions';
import {selectedIncludedChannels} from '@/lib/channels/contract';
import {refreshWhatsappInboxPage,searchWhatsappInbox} from '@/lib/whatsapp/inbox-actions';
import {loadInstagramInboxPage} from '@/lib/instagram/inbox-actions';
import {mergeInboxPageRows,matchesUnifiedInboxFilter} from './conversations-inbox';
import {matchesLeadWorklist,MANUAL_LEAD_STAGES,type ManualLeadStage,type LeadWorklist} from '@/lib/whatsapp/leads';
import {WorkspaceShell} from './workspace-shell';
import {ConversationsPage} from './conversations';
import {InstagramInbox} from './instagram-inbox';
import {Button,EmptyState,Notice,useAppCopy} from './ui';
import {ChannelBadge} from './channel-badge';
import {CompanyInboxRealtime,type InboxRealtimeEvent} from './branch-inbox-realtime';
import {inboxHref,inboxRows,matchesInboxAssignment,type InboxAssignmentFilter,type InboxChannel,type InboxRow} from './inbox-presentation';
import type {WhatsappInboxItem} from '@/lib/whatsapp/inbox-contracts';
import styles from './unified-inbox.module.css';
import {InboxDesktop,Icon,type InboxDesktopView} from './inbox-desktop';
import {desktopRows,desktopWorklistMatches} from './inbox-desktop-adapter';
import {useOptionalAccountSession} from './account-chrome';
import {useWorkspaceBootstrap} from './workspace-bootstrap';
import {InboxStartConversation} from './inbox-start-conversation';
import './conversation-workspace.css';
import './inbox-desktop-v2.css';
type Snapshot=ServiceInboxSnapshot;
export function UnifiedInbox(props:{initial:Snapshot;waReview?:boolean;igReview?:boolean;onUnavailableRetry?:()=>void}) {
 const account=useOptionalAccountSession(),workspace=useWorkspaceBootstrap();
 const {initial}=props;
 const mismatch=initial.ok&&((account&&(account.status!=='ready'||account.identity?.userId!==initial.actorId))||(workspace&&(workspace.identity.userId!==initial.actorId||workspace.workspace.selectedCompanyId!==initial.companyId)));
 const unavailable=initial.ok&&((!initial.wa.ok&&initial.wa.code==='UNAVAILABLE')||(!initial.ig.ok&&initial.ig.code==='UNAVAILABLE'));
 const admitted=mismatch?{ok:false as const,code:'SCOPE_CHANGED' as const}:unavailable?{ok:false as const,code:'UNAVAILABLE' as const}:initial;
 const key=admitted.ok?`${admitted.companyId}:${admitted.actorId}:${account?.boundaryFingerprint??''}:${admitted.waAllowed}:${admitted.igAllowed}:${admitted.wa.ok?admitted.wa.page.membershipFingerprint:''}:${admitted.ig.ok?admitted.ig.data.conversationScope:''}`:admitted.code;
 return <ScopedUnifiedInbox key={key} {...props} initial={admitted}/>;
}
function computeCounts(
 activeRows: readonly InboxRow[],
 anyActiveChannelFailed: boolean,
 actorId: string | undefined,
 tz: string | null,
 desktop: boolean,
 filter: string,
 nowMs: number,
 pinnedSet: ReadonlySet<string>,
 waConversationsById: Map<string, WhatsappInboxItem>
) {
 if (anyActiveChannelFailed) {
  return {tabs: {all: activeRows.length, unassigned: 0, mine: 0}, loaded: {all: activeRows.length, unread: 0, staff: 0}, starred: 0, worklists: {} as Record<string, number>};
 }
 let unassigned = 0, mine = 0, unread = 0, staff = 0, starred = 0;
 const wl: Record<string, number> = {all: activeRows.length, unread: 0, awaiting_staff: 0, follow_up_today: 0, overdue: 0, trial_or_quote: 0, noura: 0, resolved: 0, staff: 0};
 for (const r of activeRows) {
  if (r.assignedTo === null) unassigned++;
  if (actorId && r.assignedTo === actorId) mine++;
  if (r.unread > 0) { unread++; wl.unread++; }
  if (desktop && pinnedSet.has(r.key)) starred++;
  if (r.channel === 'whatsapp') {
   const item = waConversationsById.get(r.id);
   if (item && (item.intervention?.reasons.length ?? 0) > 0) staff++;
   if (desktop && filter !== 'instagram') {
    for (const id of ['awaiting_staff', 'follow_up_today', 'overdue', 'trial_or_quote', 'noura', 'resolved', 'staff'] as const) {
     if (desktopWorklistMatches(r, item, id, nowMs, tz)) wl[id]++;
    }
   }
  }
 }
 return {tabs: {all: activeRows.length, unassigned, mine}, loaded: {all: activeRows.length, unread, staff}, starred, worklists: wl};
}

function ScopedUnifiedInbox({initial,waReview=false,igReview=false,onUnavailableRetry}:{initial:Snapshot;waReview?:boolean;igReview?:boolean;onUnavailableRetry?:()=>void}) {
 const {locale}=useDemo(),ar=locale==='ar',router=useRouter(),copy=useAppCopy();
 // Next's route state can wait behind a pending Server Action. Selection is
 // urgent local UI state; the URL remains its source for Back/Forward and links.
 const [params,navigateLocally]=useLocalSearchParams();
 const [isNavigating,startTransition]=useTransition();
 const [snapshot,setSnapshot]=useState(initial),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(false);
 const [retained,setRetained]=useState<Extract<Snapshot,{ok:true}>|null>(initial.ok?initial:null);
 const retainedRef=useRef(retained);
 useEffect(()=>{retainedRef.current=retained;},[retained]);
 const [refreshVersion,setRefreshVersion]=useState(0),[revoked,setRevoked]=useState(false);
 const [connectionPaused,setConnectionPaused]=useState(false);
 const [moreLoading,setMoreLoading]=useState<InboxChannel|null>(null);
 const epoch=useRef(0),busy=useRef(false),mounted=useRef(true);
 const live=useRef(false),queuedRefresh=useRef(false),eventTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const accessRevoked=useRef(false),transportDown=useRef(false),pendingChange=useRef(false);
 const fallbackReads=useRef(0);
 const refreshRef=useRef<(queueIfBusy?:boolean,refreshThread?:boolean)=>Promise<void>>(async()=>{});
 const [query,setQuery]=useState(''),[debouncedQuery,setDebouncedQuery]=useState('');
 useEffect(()=>{const handle=window.setTimeout(()=>setDebouncedQuery(query.trim()),300);return()=>window.clearTimeout(handle);},[query]);
 const searchEpoch=useRef(0);
 const [serverList,setServerList]=useState<{token:string;status:'loading'|'ready'|'error';items:WhatsappInboxItem[];counts:{all:number;unassigned:number;mine:number;worklists:Record<string,number>};hasMore:boolean;nextCursor:string|null}|null>(null);
 const [lastVerifiedReadAt,setLastVerifiedReadAt]=useState<number|null>(null);
 const workspace=useWorkspaceBootstrap();
 const [liveState,setLiveState]=useState<'connecting'|'connected'|'offline'>('connecting');
 const [pinned,setPinned]=useState<string[]>([]),[pinnedOnly,setPinnedOnly]=useState(false);
 const [starRevision,setStarRevision]=useState(0),[verifiedStarsKey,setVerifiedStarsKey]=useState('');
 const [starError,setStarError]=useState(false),[pinBusy,setPinBusy]=useState<string|null>(null);
 const [desktop,setDesktop]=useState(false);
 const [startingConversation,setStartingConversation]=useState(false);
 useEffect(()=>{
  if(typeof window.matchMedia!=='function')return;
  const media=window.matchMedia('(min-width:1280px)'),update=()=>setDesktop(media.matches);
  update();media.addEventListener('change',update);
  return()=>media.removeEventListener('change',update);
 },[]);
 const [leadWorklist,setLeadWorklist]=useState<LeadWorklist>('all');
 const [leadStageFilter,setLeadStageFilter]=useState<ManualLeadStage|'all'>('all');
 const [assignmentFilter,setAssignmentFilter]=useState<InboxAssignmentFilter>('all');
 const [nowMs,setNowMs]=useState(()=>Date.now());
 const threadViewportRef=useRef<HTMLDivElement>(null);
 const expected=initial.ok?`${initial.companyId}:${initial.actorId}`:null;
 const pauseConnection=useCallback(()=>{setConnectionPaused(true);setStarRevision(value=>value+1);setLiveState('offline');live.current=false;},[]);
 const retainThroughTransportLoss=useCallback(()=>{
  setConnectionPaused(true);setStarRevision(value=>value+1);setLiveState('offline');live.current=false;setError(false);
 },[]);
 const refresh=useCallback(async(queueIfBusy=false,refreshThread=true)=>{
  if(expected===null||accessRevoked.current)return;
  if(busy.current){if(queueIfBusy)queuedRefresh.current=true;return;}
  queuedRefresh.current=false;busy.current=true;const request=++epoch.current;setRefreshing(true);
  try{const [companyId,actorId]=expected.split(':');const result=await fetchServiceInbox({companyId:companyId!,actorId:actorId!});if(!mounted.current||epoch.current!==request)return;
   if(result.ok&&`${result.companyId}:${result.actorId}`!==expected){setRetained(null);setSnapshot({ok:false,code:'SCOPE_CHANGED'});setError(true);return;}
   if(!result.ok&&'transportUnavailable' in result&&result.transportUnavailable===true){retainThroughTransportLoss();return;}
   // Soft UNAVAILABLE after a verified list is load pressure, not a denial and
   // not transport loss. Keep rows AND keep writes enabled — pausing here left
   // takeover/composer stuck disabled while messages were already on screen.
   if(!result.ok&&result.code==='UNAVAILABLE'){
    if(retainedRef.current){setError(true);return;}
    setConnectionPaused(false);setPinned([]);setPinnedOnly(false);setRetained(null);setSnapshot(result);setError(true);return;
   }
   if(!result.ok){setConnectionPaused(false);setPinned([]);setPinnedOnly(false);setRetained(null);setSnapshot(result);setError(true);return;}
   // Replace cached pages: stable identity is not proof of old assignments.
   if((!result.wa.ok&&result.wa.code==='UNAVAILABLE')||(!result.ig.ok&&result.ig.code==='UNAVAILABLE')){
    if(retainedRef.current){setError(true);return;}
    setRetained(null);setSnapshot({ok:false,code:'UNAVAILABLE'});setError(true);return;
   }
   setSnapshot(result);setRetained(result);setConnectionPaused(false);setLastVerifiedReadAt(Date.now());if(refreshThread)setRefreshVersion(n=>n+1);setError(false);
  }catch{if(mounted.current&&epoch.current===request){
   // Browser/network throw: pause only when we must recheck; keep the verified list.
   if(retainedRef.current)retainThroughTransportLoss();
   else{setRetained(null);setSnapshot({ok:false,code:'UNAVAILABLE'});setError(true);}
  }}
  finally{busy.current=false;if(mounted.current&&epoch.current===request){setRefreshing(false);if(queuedRefresh.current&&document.visibilityState==='visible')void refreshRef.current(false,false);}}
 },[expected,retainThroughTransportLoss]);
 useEffect(()=>{refreshRef.current=refresh;},[refresh]);
 const onInboxEvent=useCallback((event:InboxRealtimeEvent)=>{
  if(accessRevoked.current)return;
  if(event.type==='disconnected'||event.type==='unavailable'){
   // SSE unavailable used to wipe the verified list. Treat it like transport
   // loss: keep rows mounted, pause writes, and recheck with a fenced read.
   setLiveState('offline');setConnectionPaused(true);setStarRevision(value=>value+1);
   live.current=false;
   if(transportDown.current)return;
   transportDown.current=true;
   if(document.visibilityState==='visible')void refreshRef.current(false,false);
   return;
  }
  if(event.type==='revoked'){setConnectionPaused(false);setLiveState('offline');setPinned([]);setPinnedOnly(false);accessRevoked.current=true;setRevoked(true);live.current=false;queuedRefresh.current=false;if(eventTimer.current!==null)clearTimeout(eventTimer.current);eventTimer.current=null;epoch.current++;setRetained(null);setSnapshot({ok:false,code:'SCOPE_CHANGED'});setError(true);return;}
  if(event.type==='ready'||event.type==='reconnect'){
   setLiveState('connected');
   live.current=true;transportDown.current=false;fallbackReads.current=0;
   // Transport recovered. Resume last verified writes immediately; the fenced
   // refresh below still clears on FORBIDDEN/SCOPE_CHANGED.
   if(retainedRef.current)setConnectionPaused(false);
   if(busy.current)return; // The pending fenced read already reconciles this transport recovery.
  }
  if(event.type==='change')pendingChange.current=true;
  if(document.visibilityState!=='visible'){queuedRefresh.current=true;return;}
  if(eventTimer.current===null)eventTimer.current=setTimeout(()=>{eventTimer.current=null;const changed=pendingChange.current;pendingChange.current=false;if(mounted.current){if(changed)setRefreshVersion(n=>n+1);void refresh(changed,!changed);}},250);
 },[refresh]);
 useEffect(()=>{const fence=epoch;mounted.current=true;live.current=false;const timer=window.setInterval(()=>{if(document.visibilityState==='visible'){setNowMs(Date.now());if(!live.current&&!busy.current&&fallbackReads.current<5){fallbackReads.current++;void refresh();}}},30000);
  const onVisible=()=>{if(document.visibilityState==='visible'){fallbackReads.current=0;void refresh();}};document.addEventListener('visibilitychange',onVisible);window.addEventListener('online',onVisible);window.addEventListener('offline',pauseConnection);
  return()=>{mounted.current=false;fence.current++;queuedRefresh.current=false;if(eventTimer.current!==null)clearTimeout(eventTimer.current);eventTimer.current=null;window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('online',onVisible);window.removeEventListener('offline',pauseConnection);};
 },[refresh,pauseConnection]);
 const activeSource=snapshot.ok?snapshot:null;
 const readSuspended=!snapshot.ok;
 const channels:InboxChannel[]=activeSource&&activeSource.channelContract?(activeSource.channelContract.plan_entitlements.status==='UNCONFIGURED'
  ?([activeSource.waAllowed===true?'whatsapp':null,activeSource.igAllowed===true?'instagram':null].filter(Boolean) as InboxChannel[])
  :selectedIncludedChannels(activeSource.channelContract)):[];
 const requested=params.get('channel'),filter=channels.length===1?channels[0]:channels.includes(requested as InboxChannel)?requested as InboxChannel:'all';
 const source=params.get('source')==='instagram'||params.get('thread')?'instagram':'whatsapp';
 const selected=params.get(source==='instagram'?'thread':'c');
 const selectionValid=channels.includes(source)&&!!selected&&Boolean(activeSource?.ok&&(source==='whatsapp'?activeSource.waAllowed===true&&activeSource.wa.ok:activeSource.igAllowed===true&&activeSource.ig.ok));
 useEffect(()=>{
  const viewport=window.visualViewport,element=threadViewportRef.current;
  if(!selectionValid||!viewport||!element)return;
  const update=()=>{element.style.setProperty('--inbox-viewport-height',`${viewport.height}px`);element.style.setProperty('--inbox-viewport-top',`${viewport.offsetTop}px`);};
  update();viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);
  return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);element.style.removeProperty('--inbox-viewport-height');element.style.removeProperty('--inbox-viewport-top');};
 },[selectionValid]);
 const rows=useMemo(()=>activeSource&&retained?inboxRows(activeSource.waAllowed===true&&activeSource.wa.ok&&retained.wa.ok?retained.wa.page.conversations:[],activeSource.igAllowed===true&&activeSource.ig.ok&&retained.ig.ok?retained.ig.data.conversations:[],ar):[],[activeSource,retained,ar]);
 const rowsByKey=useMemo(()=>{const map=new Map<string,typeof rows[number]>();for(const r of rows)map.set(r.key,r);return map;},[rows]);
 const waConversationsById=useMemo(()=>{const map=new Map<string,WhatsappInboxItem>();if(retained?.wa.ok){for(const c of retained.wa.page.conversations)map.set(c.id,c);}return map;},[retained]);
 const pinnedSet=useMemo(()=>new Set(pinned),[pinned]);
 const starsQuery=JSON.stringify([...rows.map(row=>[row.channel,row.id] as const),...(serverList?.status==='ready'?serverList.items.filter(item=>!rows.some(row=>row.channel==='whatsapp'&&row.id===item.id)).map(item=>['whatsapp',item.id] as const):[])]);
 const starsKey=`${starsQuery}:${starRevision}:${refreshVersion}`;
 const starsReady=desktop&&!connectionPaused&&snapshot.ok&&verifiedStarsKey===starsKey;
 useEffect(()=>{
  if(!desktop||!expected||!snapshot.ok||connectionPaused)return;
  let cancelled=false;
  const [companyId]=expected.split(':');
  void(async()=>{try{
   const requested=JSON.parse(starsQuery) as [InboxChannel,string][];
   const found:string[]=[];
   for(const channel of ['whatsapp','instagram'] as const){
    const ids=requested.filter(row=>row[0]===channel).map(row=>row[1]);
    for(let offset=0;offset<ids.length;offset+=40){
     const result=await listInboxStars({companyId:companyId!,channel,conversationIds:ids.slice(offset,offset+40)});
     if(cancelled)return;
     if(!result.ok)throw new Error('star_read_failed');
     found.push(...result.data.map(id=>`${channel}:${id}`));
    }
   }
   if(!cancelled){setPinned(found);setVerifiedStarsKey(starsKey);setStarError(false);}
  }catch{if(!cancelled){setPinned([]);setPinnedOnly(false);setVerifiedStarsKey('');setStarError(true);}}})();
  return()=>{cancelled=true;};
 },[desktop,expected,snapshot.ok,connectionPaused,starsQuery,starsKey]);
 const refreshStars=()=>setStarRevision(value=>value+1);
 async function togglePinned(row:typeof rows[number]){
  if(!starsReady||pinBusy||!expected||accessRevoked.current)return;
  const current=epoch.current,companyId=expected.split(':')[0]!;setPinBusy(row.key);setVerifiedStarsKey('');
  try{const result=await runInboxExtension({companyId,conversationId:row.id,channel:row.channel,action:pinnedSet.has(row.key)?'unstar':'star'});
   if(!mounted.current||accessRevoked.current)return;
   if(current!==epoch.current){refreshStars();return;}
   if(result.ok)refreshStars();else{setPinned([]);setPinnedOnly(false);setVerifiedStarsKey('');setStarError(true);}
  }catch{if(mounted.current&&!accessRevoked.current){if(current!==epoch.current)refreshStars();else{setPinned([]);setPinnedOnly(false);setVerifiedStarsKey('');setStarError(true);}}}
  finally{if(mounted.current)setPinBusy(null);}
 }
 const activeChannels=filter==='all'?channels:[filter];
 const activeRows=filter==='all'?rows:rows.filter(r=>r.channel===filter);
 const anyActiveChannelFailed=activeChannels.some(channel=>{const result=channel==='whatsapp'?(snapshot.ok?snapshot.wa:retained?.wa):(snapshot.ok?snapshot.ig:retained?.ig);return !result||!result.ok;});
 const requestedWorklist=params.get('filter');
 const worklist=filter==='instagram'&&requestedWorklist!=='unread'?'all':requestedWorklist==='staff'||requestedWorklist==='noura'||requestedWorklist==='unread'||requestedWorklist==='resolved'?requestedWorklist:'all';
 const serverWorklist=worklist!=='all'?worklist:leadWorklist;
 const waPage=retained?.wa.ok?retained.wa.page:null;
 const serverMode=filter!=='instagram'&&channels.includes('whatsapp')&&Boolean(waPage)&&(debouncedQuery.length>0||Boolean(waPage?.hasMore&&(assignmentFilter!=='all'||serverWorklist!=='all'||leadStageFilter!=='all')));
 const serverToken=serverMode&&retained?.wa.ok?`${retained.companyId}:${retained.actorId}:${debouncedQuery}:${assignmentFilter}:${serverWorklist}:${leadStageFilter}`:'';
 useEffect(()=>{
  if(!serverToken)return;
  const current=++searchEpoch.current;
  let cancelled=false;
  const companyId=serverToken.split(':')[0]!;
  void searchWhatsappInbox({companyId,query:debouncedQuery,assignment:assignmentFilter,worklist:serverWorklist,stage:leadStageFilter,limit:40}).then(result=>{
   if(cancelled||current!==searchEpoch.current)return;
   if(!result.ok||result.data.companyId!==companyId){setServerList(old=>old?.token===serverToken?{...old,status:'error',items:[]}:null);return;}
   setServerList({token:serverToken,status:'ready',items:result.data.conversations,counts:{all:result.data.total,unassigned:result.data.unassignedTotal,mine:result.data.mineTotal,worklists:result.data.worklists},hasMore:result.data.hasMore,nextCursor:result.data.nextCursor});
  }).catch(()=>{if(!cancelled&&current===searchEpoch.current)setServerList(old=>old?.token===serverToken?{...old,status:'error',items:[]}:null);});
  return()=>{cancelled=true;};
 },[serverToken,debouncedQuery,assignmentFilter,serverWorklist,leadStageFilter]);
 const serverReady=Boolean(serverToken&&serverList?.token===serverToken&&serverList.status==='ready');
 const serverItems=serverReady&&serverList?serverList.items:[];
 const serverRows=serverReady?inboxRows(serverItems,[],ar):[];
 const counts = computeCounts(serverReady?serverRows.filter(row=>filter==='all'||row.channel===filter).concat(filter==='whatsapp'?[]:activeRows.filter(row=>row.channel==='instagram')):activeRows, anyActiveChannelFailed, activeSource?.actorId, retained?.wa.ok ? retained.wa.meta.timezone : null, desktop, filter, nowMs, pinnedSet, new Map([...waConversationsById, ...serverItems.map(item=>[item.id,item] as const)]));
 const shown = (() => {
  const q=query.trim().toLocaleLowerCase();
  const tz=retained?.wa.ok?retained.wa.meta.timezone:null;
  const actorId=activeSource?.actorId;
  const sort=(rowsToSort:typeof activeRows)=>rowsToSort.filter(r=>!(desktop&&starsReady&&pinnedOnly&&!pinnedSet.has(r.key))).sort((a,b)=>desktop&&starsReady?Number(pinnedSet.has(b.key))-Number(pinnedSet.has(a.key)):0);
  if(serverReady){
   const instagram=filter==='whatsapp'?[]:activeRows.filter(r=>r.channel==='instagram'&&matchesInboxAssignment(r,assignmentFilter,actorId)&&(worklist!=='unread'||r.unread>0)&&(!q||`${r.name} ${r.preview}`.toLocaleLowerCase().includes(q)));
   return sort([...serverRows,...instagram]);
  }
  return sort(activeRows.filter(r=>{
   if(!matchesInboxAssignment(r,assignmentFilter,actorId))return false;
   const item=r.channel==='whatsapp'?waConversationsById.get(r.id):undefined;
   if(desktop&&filter!=='instagram'&&leadStageFilter!=='all'&&(!item||item.leadStage!==leadStageFilter))return false;
   if(filter!=='instagram'&&leadWorklist!=='all'&&(!item||!matchesLeadWorklist(item,leadWorklist,nowMs,tz)))return false;
   if(worklist!=='all'){
    if(r.channel==='whatsapp'){
     if(!item||!matchesUnifiedInboxFilter(item,worklist))return false;
    }else if(worklist!=='unread'||r.unread===0)return false;
   }
   return !q||`${r.name} ${item?.phone??''} ${item?.topic??''} ${item?.summary??''} ${item?.messages.map(message=>message.text).join(' ')??r.preview}`.toLocaleLowerCase().includes(q);
  }));
 })();
 const scopedTabCount=(id:'all'|'unassigned'|'mine')=>{
  if(anyActiveChannelFailed)return undefined;
  const instagram=activeRows.filter(row=>row.channel==='instagram');
  const extra=filter==='whatsapp'?0:id==='all'?instagram.length:id==='unassigned'?instagram.filter(row=>row.assignedTo===null).length:instagram.filter(row=>row.assignedTo===activeSource?.actorId).length;
  if(serverReady&&serverList&&filter!=='instagram')return serverList.counts[id]+extra;
  const page=retained?.wa.ok?retained.wa.page:null;
  if(page&&filter!=='instagram'&&typeof page.unassignedTotal==='number'&&typeof page.mineTotal==='number'&&!debouncedQuery&&assignmentFilter==='all'&&serverWorklist==='all'&&leadStageFilter==='all'){
   return (id==='all'?page.total:id==='unassigned'?page.unassignedTotal:page.mineTotal)+extra;
  }
  return counts.tabs[id];
 };
 const loadedCounts=counts.loaded;
 const showEmpty=!shown.length&&(Boolean(query)||(desktop&&pinnedOnly)||assignmentFilter!=='all'||worklist!=='all'||(filter!=='instagram'&&leadWorklist!=='all')?(activeRows.length>0||!anyActiveChannelFailed):(!anyActiveChannelFailed&&activeRows.length===0));
 const filteredHref=(channel:InboxChannel|null,id:string|null,channelFilter:InboxChannel|'all'=filter)=>{const href=inboxHref(channel,id,channelFilter);return worklist==='all'?href:href+(href.includes('?')?'&':'?')+'filter='+worklist;};
 const select=(channel:InboxChannel|null,id:string|null,intentId?:string)=>{const href=filteredHref(channel,id);navigateLocally(intentId?href+(href.includes("?")?"&":"?")+"intent="+encodeURIComponent(intentId):href);};
 const activeRow=selected?(rowsByKey.get(`${source}:${selected}`)??serverRows.find(row=>row.channel===source&&row.id===selected)):undefined;
 const canStartWhatsapp=Boolean(snapshot.ok&&snapshot.waAllowed===true&&snapshot.wa.ok&&snapshot.wa.page.conversationScope==='all_company'&&channels.includes('whatsapp')&&!connectionPaused&&!waReview&&!revoked);
 async function more(channel:InboxChannel){
  if(connectionPaused||accessRevoked.current||moreLoading!==null||busy.current||!snapshot.ok||!retained)return;
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
  finally{busy.current=false;if(mounted.current&&epoch.current===request){setMoreLoading(null);if(queuedRefresh.current&&document.visibilityState==='visible')void refreshRef.current(false,false);}}
 }
 const selectedDesktopWorklist=filter==='instagram'?worklist:worklist!=='all'?worklist:leadWorklist;
 const setDesktopWorklist=(value:string)=>{
  const isLead=['awaiting_staff','follow_up_today','overdue','trial_or_quote'].includes(value);
  setLeadWorklist(isLead?value as LeadWorklist:'all');
  const next=new URLSearchParams(params.toString());
  if(isLead||value==='all')next.delete('filter');else next.set('filter',value);
  if(next.toString()!==params.toString())navigateLocally('/app/conversations'+(next.size?'?'+next.toString():''));
 };
 const desktopWorklists = (() => {
  if(!desktop)return[];
  return(['all','unread','awaiting_staff','follow_up_today','overdue','trial_or_quote','noura','resolved','staff'] as const)
   .filter(id=>filter!=='instagram'||id==='all'||id==='unread').map(id=>({id,
    label:id==='all'?(ar?'كل الحالات':'All states'):id==='unread'?(ar?'غير مقروءة':'Unread'):id==='noura'?(ar?'المساعد الآلي':'Automation'):id==='resolved'?(ar?'محلولة':'Resolved'):id==='staff'?(ar?'تحتاج مراجعة بشرية':'Needs human review'):copy.app.worklists[id as Exclude<LeadWorklist,'all'>],
    count:anyActiveChannelFailed?undefined:serverReady&&serverList&&filter!=='instagram'?serverList.counts.worklists[id]:counts.worklists[id],
   }));
 })();
 const desktopView:InboxDesktopView={
  state:'ready',scopeKey:expected??'',messages:[],query,onQueryChange:setQuery,
  workspace:{label:workspace?.workspace.choices.find(choice=>choice.companyId===activeSource?.companyId)?.displayName??(ar?'المحادثات':'Conversations'),liveState:connectionPaused?'offline':liveState,updatedAt:lastVerifiedReadAt?new Date(lastVerifiedReadAt).toLocaleTimeString(ar?'ar-OM':'en-GB',{hour:'2-digit',minute:'2-digit'}):undefined,busy:refreshing,refresh:{id:'refresh',label:ar?'تحديث':'Refresh',icon:'refresh',disabled:moreLoading!==null,onClick:()=>void refresh()}},
  notice:connectionPaused?(ar?'الاتصال متوقف مؤقتًا. الرسائل المعروضة من آخر تحميل؛ الإرسال متوقف حتى التحقق مجددًا.':'Connection interrupted. Showing the last loaded messages; sending is paused until access is verified again.'):serverList?.token===serverToken&&serverList.status==='error'?(ar?'تعذّر بحث المحادثات المسموح بها. أعد المحاولة.':'Permitted conversations could not be searched. Try again.'):undefined,
  newConversation:{id:'new-conversation',label:ar?'إنشاء محادثة جديدة':'New conversation',icon:'edit',disabled:!canStartWhatsapp,reason:canStartWhatsapp?undefined:(ar?'يلزم اتصال واتساب وصلاحية محادثات النشاط.':'A WhatsApp connection and company-wide conversation access are required.'),onClick:()=>setStartingConversation(true)},
  selectedId:activeRow?.key,conversations:desktopRows(shown,ar,starsReady?pinnedSet:undefined),
  starredFilter:{active:pinnedOnly,ready:starsReady,count:starsReady?counts.starred:undefined,onToggle:()=>setPinnedOnly(value=>!value)},
  onToggleStar:key=>{const row=rowsByKey.get(key);if(row)void togglePinned(row);},
  starsReady,starBusyKey:pinBusy,
  onSelect:key=>{const row=rowsByKey.get(key)??serverRows.find(item=>item.key===key);if(row)select(row.channel,row.id);},
  tabs:(['all','unassigned','mine'] as const).map(id=>({id,label:id==='all'?(ar?'الكل':'All'):id==='unassigned'?(ar?'غير مسند':'Unassigned'):(ar?'مسند لي':'Assigned to me'),count:scopedTabCount(id)})),
  activeTab:assignmentFilter,onTabChange:id=>setAssignmentFilter(id as InboxAssignmentFilter),
  filters:{channel:filter,channels:[{id:'all',label:ar?'كل القنوات':'All channels'},...channels.map(id=>({id,label:id==='whatsapp'?'WhatsApp':'Instagram'}))],onChannelChange:id=>{if(id==='instagram'){setLeadWorklist('all');setLeadStageFilter('all');navigateLocally(worklist==='all'||worklist==='unread'?filteredHref(null,null,'instagram'):inboxHref(null,null,'instagram'));}else navigateLocally(filteredHref(null,null,id as InboxChannel|'all'));},
   worklist:selectedDesktopWorklist,worklists:desktopWorklists,onWorklistChange:setDesktopWorklist,stages:filter!=='instagram'&&channels.includes('whatsapp')?[{id:'all',label:ar?'كل المراحل':'All stages'},...MANUAL_LEAD_STAGES.map(id=>({id,label:copy.app.leadStages[id]}))]:undefined,stage:leadStageFilter,onStageChange:id=>setLeadStageFilter(id as ManualLeadStage|'all'),starred:{active:pinnedOnly,ready:starsReady,count:starsReady?counts.starred:undefined,onToggle:()=>setPinnedOnly(value=>!value)}},
  onStarChanged:refreshStars,
  listFooter:<>{channels.map(channel=>{const result=channel==='whatsapp'?snapshot.ok?snapshot.wa:retained?.wa:snapshot.ok?snapshot.ig:retained?.ig;return result&&!result.ok?<Notice key={channel} tone="error"><ChannelBadge channel={channel} ar={ar}/>{result.code}</Notice>:null;})}<Link href={filter==='instagram'?'/app/instagram':'/app/settings?tab=whatsapp'}>{ar?'إعدادات الربط':'Connection settings'}</Link>{retained?.wa.ok&&retained.wa.page.hasMore&&channels.includes('whatsapp')&&<button type="button" className="vdi-small-button" aria-busy={moreLoading==='whatsapp'} disabled={refreshing||moreLoading!==null} onClick={()=>void more('whatsapp')}><Icon name="down"/>{ar?'مزيد من واتساب':'More WhatsApp'}</button>}{retained?.ig.ok&&retained.ig.data.hasMore&&channels.includes('instagram')&&<button type="button" className="vdi-small-button" aria-busy={moreLoading==='instagram'} disabled={refreshing||moreLoading!==null} onClick={()=>void more('instagram')}><Icon name="down"/>{ar?'مزيد من إنستجرام':'More Instagram'}</button>}</>,
 };
 return <WorkspaceShell immersive={desktop||selectionValid} title={ar?'المحادثات':'Conversations'} actions={revoked?<a href={`/app/conversations${params.toString()?`?${params.toString()}`:''}`} className="underline">{ar?'إعادة تحميل الصفحة للتحقق':'Reload page to verify'}</a>:<Button variant="secondary" busy={refreshing||isNavigating} disabled={moreLoading!==null} onClick={()=>{if(!initial.ok){if(onUnavailableRetry)onUnavailableRetry();else startTransition(()=>router.refresh());}else void refresh();}}>{ar?'تحديث':'Refresh'}</Button>}>
  {initial.ok&&<div className={styles.realtime} data-inbox-realtime-status><CompanyInboxRealtime separateTransport key={`${initial.companyId}:${initial.actorId}`} companyId={initial.companyId} actorId={initial.actorId} ar={ar} onInboxEvent={onInboxEvent}/></div>}
  {error&&snapshot.ok&&<Notice tone="error">{ar?'تعذّر التحقق من آخر تحديث. حدّث الصفحة قبل متابعة العمل.':'The latest update could not be verified. Refresh before continuing.'}</Notice>}
  {desktop&&starError&&snapshot.ok&&!connectionPaused&&<Notice tone="error">{ar?'تعذّر تحميل المحادثات المميزة.':'Starred conversations could not be loaded.'} <button type="button" onClick={refreshStars}>{ar?'إعادة المحاولة':'Retry'}</button></Notice>}
  {!snapshot.ok&&snapshot.code==='UNAVAILABLE'?<div data-inbox-offline="true" data-pixel-port={desktop}><InboxDesktop locale={locale} view={{state:'ready',scopeKey:expected??'unavailable',conversations:[],messages:[],tabs:[],activeTab:'all',onTabChange:id=>setAssignmentFilter(id as InboxAssignmentFilter),query,onQueryChange:setQuery,onSelect:key=>{const row=rowsByKey.get(key);if(row)select(row.channel,row.id);},emptyListLabel:ar?'ستظهر المحادثات عند استعادة الاتصال.':'Conversations will appear when the connection returns.',notice:ar?'تعذّر تحديث الاتصال حاليًا. ستبقى مساحة المحادثات مفتوحة.':'Connection cannot be refreshed right now. The inbox remains open.',workspace:{label:ar?'المحادثات':'Conversations',liveState:'offline',busy:refreshing||isNavigating,refresh:{id:'retry',label:ar?'إعادة المحاولة':'Retry',icon:'refresh',disabled:refreshing||isNavigating,onClick:()=>{if(!initial.ok){if(onUnavailableRetry)onUnavailableRetry();else startTransition(()=>router.refresh());}else void refresh();}}},listFooter:undefined}}/><section className={styles.offlineMobile}><h2>{ar?'صندوق الوارد':'Inbox'}</h2><p role="status">{ar?'الاتصال غير متاح حاليًا.':'Connection is currently unavailable.'}</p><Button disabled={refreshing||isNavigating} onClick={()=>{if(!initial.ok)startTransition(()=>router.refresh());else void refresh();}}>{ar?'إعادة المحاولة':'Retry'}</Button></section></div>:!snapshot.ok?<Notice tone="warn">{snapshot.code==='NO_COMPANY'?(ar?'اختر نشاطًا من قائمة مساحة العمل.':'Choose a business from the workspace menu.'):snapshot.code==='FORBIDDEN'?<><strong>{copy.app.inboxAccessDeniedTitle}</strong><p>{copy.app.inboxAccessDeniedBody}</p></>:(ar?'تغيّرت الجلسة أو مساحة العمل. حدّث الصفحة للتحقق قبل المتابعة.':'The session or workspace changed. Refresh to verify before continuing.')} <Link href="/app/settings?tab=plan" className="underline ms-2">{ar?'الاشتراك والدعم':'Subscription and support'}</Link></Notice>:null}
  {activeSource&&retained&&<>
   {startingConversation&&canStartWhatsapp&&<InboxStartConversation companyId={activeSource.companyId} ar={ar} enabled={canStartWhatsapp} onClose={()=>setStartingConversation(false)} onCreated={id=>{setStartingConversation(false);setQuery('');setAssignmentFilter('all');setLeadWorklist('all');setLeadStageFilter('all');setPinnedOnly(false);navigateLocally(inboxHref('whatsapp',id,'all'));void refresh(true);}}/>}
   {snapshot.ok&&!snapshot.channelContract&&<Notice tone="error">{ar?'تعذّر التحقق من إعداد استحقاقات القنوات. أعد التحديث.':'Channel entitlement configuration could not be verified. Refresh to retry.'}</Notice>}
   {snapshot.ok&&snapshot.channelContract&&snapshot.channelContract.plan_entitlements.status==='approved'&&!channels.length&&<Notice tone="warn">{ar?'يلزم تأكيد اختيار القنوات لهذه النسخة من الباقة. الاختيارات والسجل السابقان محفوظان.':'Channel selection needs confirmation for this plan version. Previous choices and history are retained.'}</Notice>}
   {(snapshot.ok&&(snapshot.waAllowed===null||snapshot.igAllowed===null))&&<Notice>{ar?'تعذّر التحقق من بعض صلاحيات القنوات.':'Some channel permissions could not be verified.'}</Notice>}
   {!channels.length&&snapshot.ok&&<EmptyState title={ar?'لا توجد قناة متاحة للقراءة':'No channel is available to read'} body={ar?'الاشتراك والربط والصلاحيات حالات مستقلة. راجع الإعدادات أو تواصل مع صاحب النشاط.':'Subscription, connection and permissions are separate. Review settings or contact your business owner.'} action={<Link href="/app/settings">{ar?'الإعدادات':'Settings'}</Link>}/>}<div className={styles.inbox} hidden={!channels.length} data-selected={selectionValid} data-inbox-desktop-v2={desktop?undefined:"true"} data-pixel-port={desktop}>
    <section hidden={desktop} inert={readSuspended} className={styles.list} aria-label={ar?'قائمة المحادثات':'Conversation list'}>
     <header className={styles.listHeader}><h2>{ar?'صندوق الوارد':'Inbox'}</h2><p>{ar?'المحادثات المتاحة لهذا النشاط':'Available conversations for this business'}</p>
      {worklist!=='all'&&<p role="status">{worklist==='staff'?(ar?'تحتاج متابعة · واتساب':'Needs attention · WhatsApp'):worklist==='noura'?(ar?'الأتمتة مسموحة · واتساب':'Automation permitted · WhatsApp'):worklist==='unread'?(ar?'غير مقروءة':'Unread'):(ar?'محلولة · واتساب':'Resolved · WhatsApp')} <button type="button" className={styles.filterReset} onClick={()=>navigateLocally(inboxHref(null,null,filter))}>{ar?'مسح الفلتر':'Clear filter'}</button></p>}
      <label className={styles.search}><span className="sr-only">{ar?'بحث في المحادثات المحمّلة':'Search loaded conversations'}</span><svg className={styles.searchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6"/><path d="m16 16 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={ar?'البحث في المحادثات أو العملاء…':'Search conversations or customers…'}/></label>
      <div className="inbox-v2-assignment-tabs" role="group" aria-label={ar?'تصفية التعيين':'Assignment filter'}>{(['all','unassigned','mine'] as const).map(value=><button key={value} type="button" aria-pressed={assignmentFilter===value} onClick={()=>setAssignmentFilter(value)}>{value==='all'?(ar?'الكل':'All'):value==='unassigned'?(ar?'غير مسند':'Unassigned'):(ar?'مسند لي':'Assigned to me')}{!anyActiveChannelFailed&&<span title={ar?'عدد المحادثات في الصفحات المحمّلة':'Conversation count in loaded pages'}>{counts.tabs[value]}</span>}</button>)}</div>
      <details className="inbox-v2-extra-filters"><summary>{ar?'القنوات والمتابعة':'Channels & follow-up'}<span>{leadWorklist==='all'?(ar?'كل الحالات':'All states'):copy.app.worklists[leadWorklist]}</span></summary>
      {channels.length===2?<div className={styles.channelFilters} aria-label={ar?'القناة':'Channel'}>{(['all',...channels] as const).map(c=><button key={c} type="button" aria-pressed={filter===c} onClick={()=>navigateLocally(filteredHref(null,null,c))}>{c==='all'?(ar?'الكل':'All'):<ChannelBadge channel={c} ar={ar}/>}</button>)}</div>:<ChannelBadge channel={channels[0]??'whatsapp'} ar={ar}/>}
      <div className={styles.worklistFilters} aria-label={ar?'تصفية المحادثات':'Conversation filters'}>{(['all','unread','staff','noura','resolved'] as const).map(value=><button type="button" key={value} aria-pressed={worklist===value} onClick={()=>{const next=new URLSearchParams(params.toString());next.delete('c');next.delete('thread');next.delete('source');next.delete('intent');if(value==='all')next.delete('filter');else next.set('filter',value);navigateLocally('/app/conversations'+(next.size?'?'+next.toString():''));}}>{value==='all'?(ar?'الكل':'All'):value==='unread'?(ar?'غير مقروءة':'Unread'):value==='staff'?(ar?'تحتاج متابعة':'Needs attention'):value==='noura'?(ar?'الأتمتة':'Automation'):(ar?'محلولة':'Resolved')}{!anyActiveChannelFailed&&(value==='all'||value==='unread'||value==='staff')&&<span className={styles.filterCount} title={ar?'عدد المحادثات في الصفحات المحمّلة':'Conversation count in loaded pages'}>{loadedCounts[value]}</span>}</button>)}</div>
      {filter!=='instagram'&&channels.includes('whatsapp')&&<label className={styles.leadFilter}><span>{ar?'متابعة واتساب':'WhatsApp follow-up'}</span><select value={leadWorklist} onChange={event=>setLeadWorklist(event.target.value as LeadWorklist)}>{(['all','awaiting_staff','follow_up_today','overdue','trial_or_quote'] as const).map(value=><option key={value} value={value}>{value==='all'?(ar?'كل المراحل':'All stages'):copy.app.worklists[value]}</option>)}</select></label>}
      </details>
     </header>
     <div className={styles.rows}>{channels.map(channel=>{const result=channel==='whatsapp'?snapshot.ok?snapshot.wa:retained.wa:snapshot.ok?snapshot.ig:retained.ig;if(result.ok)return null;const isForbidden=result.code==='FORBIDDEN';return <Notice key={channel} tone={isForbidden?'warn':'error'}><ChannelBadge channel={channel} ar={ar}/><p>{isForbidden?(ar?'القراءة غير متاحة. راجع صلاحيات القناة والاشتراك.':'Reading unavailable. Check channel permissions and subscription.'):(ar?'تعذّر تحميل القناة. أعد التحديث.':'This channel could not be loaded. Refresh to retry.')}{!isForbidden&&<button type="button" className="underline ms-2 font-medium" disabled={refreshing||moreLoading!==null} onClick={()=>void refresh()}>{ar?'إعادة المحاولة':'Retry'}</button>}</p></Notice>;})}
      {showEmpty&&<EmptyState title={query||(desktop&&pinnedOnly)||assignmentFilter!=='all'||worklist!=='all'||(filter!=='instagram'&&leadWorklist!=='all')?(ar?'لا نتائج في المحادثات المحمّلة':'No matches in loaded conversations'):(ar?'لا توجد محادثات بعد':'No conversations yet')} body={(desktop&&pinnedOnly)?(ar?'لا توجد محادثات مميزة تطابق البحث. ألغِ فلتر المميزة لعرض القائمة.':'No starred conversations match. Turn off Starred to see all conversations.'):assignmentFilter!=='all'||worklist!=='all'||(filter!=='instagram'&&leadWorklist!=='all')?(ar?'لا توجد محادثات تطابق البحث والفلتر في الصفحة المحمّلة. يمكنك مسح الفلتر أو تحميل المزيد.':'No conversations match this search and filter in the loaded page. Clear the filter or load more.'):query?(ar?'لم نجد أي محادثة تطابق بحثك في المحادثات المحمّلة.':'No conversations matched your search in loaded conversations.'):(ar?'تظهر الرسائل الواردة بعد ربط القناة والتحقق من استقبالها.':'Inbound messages appear after connecting and verifying the channel.')}/>}
      {shown.map(row=>{
       const phone=row.channel==='whatsapp'?waConversationsById.get(row.id)?.phone??null:null;
       
       return <div key={row.key} className={styles.rowContainer}>
        <button type="button" className={styles.row} aria-current={source===row.channel&&selected===row.id?'page':undefined} onClick={()=>select(row.channel,row.id)}>
         <span className={styles.avatar} aria-hidden="true">{row.name.slice(0,1)}</span><span className={styles.rowBody}>
          <span className={styles.rowHeading}><strong dir="auto">{row.name}</strong>{row.at>0&&<time dateTime={new Date(row.at).toISOString()} title={new Date(row.at).toLocaleString(ar?'ar-OM':'en-GB')}>{new Date(row.at).toLocaleDateString(ar?'ar-OM':'en-GB',{day:'numeric',month:'short'})}</time>}</span>
          {phone&&<span className={styles.phone} dir="ltr">{phone}</span>}
          <span className={styles.preview} dir="auto">{row.preview||'—'}</span>
          <span className={styles.rowFooter}><ChannelBadge channel={row.channel} ar={ar}/>{row.assignedTo&&<span className={styles.assignment}>{ar?'مسندة':'Assigned'}</span>}{row.unread>0&&<span className={styles.unread} aria-label={ar?`${row.unread} غير مقروءة`:`${row.unread} unread`}>{row.unread}</span>}</span>
         </span>
        </button>
        
       </div>;
      })}
     </div>
     <footer className={styles.listFooter}><p>{ar?'الترتيب حسب آخر نشاط بين الصفحات المحمّلة.':'Ordered by latest activity across loaded pages.'}</p><Link href={filter==='instagram'?'/app/instagram':'/app/settings?tab=whatsapp'}>{ar?'إعدادات الربط':'Connection settings'}</Link>
      {retained.wa.ok&&retained.wa.page.hasMore&&channels.includes('whatsapp')&&<Button variant="ghost" busy={moreLoading==='whatsapp'} disabled={refreshing||moreLoading!==null} onClick={()=>void more('whatsapp')}>{ar?'مزيد من واتساب':'More WhatsApp'}</Button>}
      {retained.ig.ok&&retained.ig.data.hasMore&&channels.includes('instagram')&&<Button variant="ghost" busy={moreLoading==='instagram'} disabled={refreshing||moreLoading!==null} onClick={()=>void more('instagram')}>{ar?'مزيد من إنستجرام':'More Instagram'}</Button>}
     </footer>
    </section>
    <div ref={threadViewportRef} className={styles.thread} data-open={selectionValid} inert={readSuspended}>
     <fieldset disabled={readSuspended||connectionPaused} style={{border:0,padding:0,margin:0,minWidth:0,display:'contents'}}>
     {!desktop&&selectionValid&&<div className={styles.threadToolbar}><button type="button" onClick={()=>select(null,null)} className={styles.back}>{ar?'الرجوع للمحادثات':'Back to conversations'}</button><Button variant="ghost" busy={refreshing} disabled={moreLoading!==null} onClick={()=>void refresh()} aria-label={ar?"تحديث المحادثة":"Refresh conversation"}>{ar?"تحديث":"Refresh"}</Button><ChannelBadge channel={source} ar={ar}/><span dir="auto">{activeRow?.name??(ar?'المحادثة':'Conversation')}</span></div>}
     {desktop&&!selectionValid&&<InboxDesktop view={desktopView} locale={locale}/>}
     {!desktop&&!selectionValid&&<div className={styles.welcome}><EmptyState title={ar?'اختر محادثة للبدء':'Choose a conversation'} body={ar?'كل رد يخرج عبر قناة المحادثة نفسها. بيانات الأنشطة والحسابات تبقى منفصلة.':'Each reply uses its conversation’s channel. Business and account histories remain separate.'}/></div>}
     {/* Keep native panes mounted: drafts and unresolved operation IDs survive channel navigation. */}
     {retained.wa.ok&&<div className={styles.pane} hidden={!selectionValid||source!=='whatsapp'} inert={!selectionValid||source!=='whatsapp'}><ConversationsPage connectionPaused={connectionPaused} onConnectionUnavailable={pauseConnection} desktopView={desktop?desktopView:undefined} threadReader={fetchInboxThread} key={retained.wa.page.membershipFingerprint} readSuspended={readSuspended} refreshVersion={refreshVersion} draftActorId={retained.actorId} embedded selectedConversationId={selectionValid&&source==='whatsapp'?selected:null} onSelectConversation={id=>select('whatsapp',id)} inbox={retained.wa.conversations} page={retained.wa.page} meta={retained.wa.meta} reviewCompanyId={waReview?retained.companyId:undefined}/></div>}
     {retained.igAllowed===true&&<div className={styles.pane} hidden={!selectionValid||source!=='instagram'} inert={!selectionValid||source!=='instagram'}><InstagramInbox connectionPaused={connectionPaused} desktopView={desktop?desktopView:undefined} key={retained.ig.ok?retained.ig.data.conversationScope:'unverified'} readSuspended={readSuspended} canAssign={snapshot.ok&&snapshot.igAssignAllowed===true} refreshVersion={refreshVersion} embedded selectedConversationId={selectionValid&&source==='instagram'?selected:null} onSelectConversation={(id,intent)=>select('instagram',id,intent)} companyId={retained.companyId} owner={retained.owner} companyInSetup={retained.companyInSetup} reviewMode={igReview}/></div>}
     </fieldset>
    </div>
   </div>
  </>}
 </WorkspaceShell>;
}

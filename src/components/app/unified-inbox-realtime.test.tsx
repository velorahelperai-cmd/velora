// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {InboxRealtimeEvent} from './branch-inbox-realtime';
import {appCopy} from '@/lib/app-copy';
import {InboxDesktop,type InboxDesktopView} from './inbox-desktop';
const m=vi.hoisted(()=>({fetch:vi.fn(),threadVersions:[] as number[],event:null as null|((e:InboxRealtimeEvent)=>void),router:{refresh:vi.fn()},account:null as null|{status:'ready'|'locked';identity:{userId:string};boundaryFingerprint:string},params:new URLSearchParams('source=whatsapp&c=thread')}));
vi.mock('next/navigation',()=>({useRouter:()=>m.router}));
vi.mock('next/link',()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
vi.mock('@/lib/navigation/use-local-search-params',()=>({useLocalSearchParams:()=>[m.params,vi.fn()]}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en'})}));
vi.mock('@/lib/customer/service-inbox-read',()=>({fetchServiceInbox:m.fetch}));
vi.mock('@/lib/whatsapp/inbox-actions',()=>({refreshWhatsappInboxPage:vi.fn(),searchWhatsappInbox:vi.fn(async()=>({ok:false,code:'UNAVAILABLE'}))}));
vi.mock('@/lib/instagram/inbox-actions',()=>({loadInstagramInboxPage:vi.fn()}));
vi.mock('./workspace-shell',()=>({WorkspaceShell:({children,actions}:{children:React.ReactNode;actions:React.ReactNode})=><main>{actions}{children}</main>}));
vi.mock('./ui',()=>({Button:({children,onClick,disabled}:{children:React.ReactNode;onClick:()=>void;disabled:boolean})=><button onClick={onClick} disabled={disabled}>{children}</button>,Notice:({children}:{children:React.ReactNode})=><aside>{children}</aside>,EmptyState:()=>null,useAppCopy:()=>({app:{...appCopy('en').app,inboxAccessDeniedTitle:"Denied",inboxAccessDeniedBody:"No access",inboxLoadFailedBody:"Unavailable"}})}));
vi.mock('./conversations',()=>({ConversationsPage:({refreshVersion,desktopView}:{refreshVersion:number;desktopView?:InboxDesktopView})=>{m.threadVersions.push(refreshVersion);const [draft]=useState('Unsaved draft');return <><textarea aria-label="Preserved draft" defaultValue={draft}/>{desktopView&&<InboxDesktop view={desktopView} locale="en"/>}</>;}}));
vi.mock('./instagram-inbox',()=>({InstagramInbox:()=>null}));
vi.mock('./branch-inbox-realtime',()=>({CompanyInboxRealtime:({onInboxEvent}:{onInboxEvent:(e:InboxRealtimeEvent)=>void})=>{m.event=onInboxEvent;return null;}}));
vi.mock('./account-chrome',()=>({useOptionalAccountSession:()=>m.account}));
import {UnifiedInbox} from './unified-inbox';
type Snapshot=React.ComponentProps<typeof UnifiedInbox>['initial'];
const row={id:'thread',customer:'Previously verified contact',phone:'synthetic',messages:[],unreadCount:0};
const initial={ok:true,companyId:'company',actorId:'actor',owner:true,companyInSetup:false,waAllowed:true,igAllowed:false,igAssignAllowed:false,channelContract:{plan_entitlements:{status:'UNCONFIGURED'}},channel_access:{whatsapp:true,instagram:false},wa:{ok:true,conversations:[row],page:{companyId:'company',conversationScope:'all_company',kind:'partial',ordering:'newest_created',conversations:[row],hasMore:false,nextCursor:null,total:0,unreadTotal:0,interventionTotal:0,membershipFingerprint:'same'},meta:{companyId:'company',conversationScope:'all_company',timezone:null,timezoneAnnouncedUtc:true,canReply:true,canAssign:false,assignees:[],counts:{}}},ig:{ok:false,code:'FORBIDDEN'}} as unknown as Snapshot;
let root:Root,container:HTMLDivElement;
beforeEach(()=>{m.account=null;vi.clearAllMocks();vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});m.fetch.mockResolvedValue(initial);container=document.createElement('div');document.body.append(container);root=createRoot(container);act(()=>root.render(<UnifiedInbox initial={initial}/>));});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('filters loaded assignment locally without fetching or discarding the open draft',()=>{
 const draft=container.querySelector('textarea');
 const list=container.querySelector('section[aria-label="Conversation list"]');
 const unassigned=Array.from(container.querySelectorAll('button')).find(button=>button.textContent?.startsWith('Unassigned'));
 const mine=Array.from(container.querySelectorAll('button')).find(button=>button.textContent?.startsWith('Assigned to me'));
 expect(unassigned).toBeTruthy();expect(mine).toBeTruthy();
 act(()=>unassigned!.click());expect(list?.textContent).toContain('Previously verified contact');
 act(()=>mine!.click());expect(list?.textContent).not.toContain('Previously verified contact');
 expect(container.querySelector('textarea')).toBe(draft);expect(m.fetch).not.toHaveBeenCalled();
});
it('coalesces event bursts, retains the pane draft and suspends polling while connected',async()=>{
 const draft=container.querySelector('textarea');
 act(()=>{m.event?.({type:'ready'});for(let i=0;i<10;i++)m.event?.({type:'change'});});
 await act(async()=>vi.advanceTimersByTimeAsync(250));expect(m.fetch).toHaveBeenCalledTimes(1);
 await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(m.fetch).toHaveBeenCalledTimes(1);expect(container.querySelector('textarea')).toBe(draft);expect(draft?.value).toBe('Unsaved draft');
 act(()=>m.event?.({type:'unavailable'}));expect(m.fetch).toHaveBeenCalledTimes(2);
 expect(container.querySelector('textarea')).toBe(draft);expect(container.textContent).toContain('Previously verified contact');
 await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(m.fetch).toHaveBeenCalledTimes(3);
 expect(container.querySelector('textarea')).toBe(draft);
});
it('does not lose an event arriving while a read is pending',async()=>{
 let complete!:(v:Snapshot)=>void;m.fetch.mockImplementationOnce(()=>new Promise<Snapshot>(resolve=>{complete=resolve;}));
 act(()=>m.event?.({type:'ready'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 act(()=>{m.event?.({type:'change'});m.event?.({type:'change'});});await act(async()=>vi.advanceTimersByTimeAsync(250));expect(m.fetch).toHaveBeenCalledTimes(1);
 await act(async()=>complete(initial));expect(m.fetch).toHaveBeenCalledTimes(2);
});
it('locks the snapshot on revocation and discards an earlier successful read',async()=>{
 let complete!:(v:Snapshot)=>void;m.fetch.mockImplementationOnce(()=>new Promise<Snapshot>(resolve=>{complete=resolve;}));
 act(()=>m.event?.({type:'ready'}));await act(async()=>vi.advanceTimersByTimeAsync(250));act(()=>m.event?.({type:'revoked'}));
 await act(async()=>complete(initial));expect(container.querySelector('textarea')).toBeNull();expect(container.textContent).toContain('The session or workspace changed');
 const recovery=Array.from(container.querySelectorAll('a')).find(a=>a.textContent==='Reload page to verify');
 expect(recovery?.getAttribute('href')).toBe('/app/conversations?source=whatsapp&c=thread');
 expect(m.fetch).toHaveBeenCalledTimes(1);
});

it('keeps the previously read pane during soft UNAVAILABLE without pausing verified writes',async()=>{
 const draft=container.querySelector('textarea');
 m.fetch.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'});
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.textContent).toContain('Previously verified contact');
 expect(container.querySelector('fieldset')?.disabled).toBe(false);
 expect(container.querySelector('[data-inbox-offline="true"]')).toBeNull();
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.querySelector('fieldset')?.disabled).toBe(false);
});
it.each(['FORBIDDEN','SCOPE_CHANGED','NO_COMPANY'])('erases cached content after %s, including a later temporary outage',async code=>{
 m.fetch.mockResolvedValueOnce({ok:false,code});
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));expect(container.querySelector('textarea')).toBeNull();
 m.fetch.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'});
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));expect(container.querySelector('textarea')).toBeNull();
});
it('does not carry a cached pane into another company or actor',async()=>{
 for(const replacement of [{ok:false,code:'NO_COMPANY'},{...initial,companyId:'other',waAllowed:false,wa:{ok:false,code:'FORBIDDEN'}},{...initial,actorId:'other',waAllowed:false,wa:{ok:false,code:'FORBIDDEN'}}]){
  await act(async()=>root.render(<UnifiedInbox initial={replacement as Snapshot}/>));expect(container.querySelector('textarea')).toBeNull();
 }
});
it('drops a formerly allowed channel when the refreshed capability is denied',async()=>{
 m.fetch.mockResolvedValueOnce({...initial,waAllowed:false,wa:{ok:false,code:'FORBIDDEN'}});
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));expect(container.querySelector('textarea')).toBeNull();
});

it('drops prior data immediately when the confirmed account is locked or changes actor',async()=>{
 for(const account of [{status:'locked',identity:{userId:'actor'},boundaryFingerprint:'old'},{status:'ready',identity:{userId:'other'},boundaryFingerprint:'new'}] as const){
  m.account=account;await act(async()=>root.render(<UnifiedInbox initial={initial}/>));
  expect(container.querySelector('textarea')).toBeNull();expect(container.textContent).not.toContain('Previously verified contact');
 }
});

it('pauses on live-stream loss, then resumes verified writes when the stream reconnects even if a soft recheck fails',async()=>{
 let finish!:(v:Snapshot)=>void;
 m.fetch.mockImplementationOnce(()=>new Promise<Snapshot>(resolve=>{finish=resolve;}));
 const draft=container.querySelector('textarea');
 await act(async()=>m.event?.({type:'unavailable'}));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.querySelector('fieldset')?.disabled).toBe(true);
 expect(container.textContent).toContain('Previously verified contact');
 expect(container.querySelector('[data-inbox-offline="true"]')).toBeNull();
 await act(async()=>finish({ok:false,code:'UNAVAILABLE'} as Snapshot));
 // Soft recheck must not keep writes paused once the stream is back.
 await act(async()=>m.event?.({type:'reconnect'}));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.querySelector('fieldset')?.disabled).toBe(false);
});

it('retains verified data on an unclassified reader exception after a successful list, then recovers',async()=>{
 const draft=container.querySelector('textarea');
 m.fetch.mockRejectedValueOnce(new Error('offline'));
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.textContent).toContain('Previously verified contact');
 expect(container.querySelector('fieldset')?.disabled).toBe(true);
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.querySelector('fieldset')?.disabled).toBe(false);
});
it('keeps the verified pane when SSE unavailable races an in-flight read',async()=>{
 let complete!:(v:Snapshot)=>void;m.fetch.mockImplementationOnce(()=>new Promise<Snapshot>(resolve=>{complete=resolve;}));
 const draft=container.querySelector('textarea');
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 act(()=>m.event?.({type:'unavailable'}));await act(async()=>complete(initial));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.textContent).toContain('Previously verified contact');
 act(()=>m.event?.({type:'reconnect'}));await act(async()=>vi.advanceTimersByTimeAsync(250));expect(container.querySelector('textarea')).toBe(draft);
});
it('does not merge removed staff assignments into a fresh page with unchanged identity',async()=>{
 if(!initial.ok||!initial.wa.ok)throw new Error('fixture');
 m.fetch.mockResolvedValueOnce({...initial,wa:{...initial.wa,conversations:[],page:{...initial.wa.page,conversations:[]}}});
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(container.textContent).not.toContain('Previously verified contact');
});

it('remounts the native pane after a changed staff membership fingerprint',async()=>{
 if(!initial.ok||!initial.wa.ok)throw new Error('fixture');
 const draft=container.querySelector('textarea');
 m.fetch.mockResolvedValueOnce({...initial,owner:false,wa:{...initial.wa,conversations:[],page:{...initial.wa.page,conversationScope:'assigned_only',membershipFingerprint:'reassigned',conversations:[]}}});
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(container.querySelector('textarea')).not.toBe(draft);expect(container.textContent).not.toContain('Previously verified contact');
});
it('does not render another channel when the initial channel read is unavailable',async()=>{
 await act(async()=>root.render(<UnifiedInbox initial={{...initial,ig:{ok:false,code:'UNAVAILABLE'}} as Snapshot}/>));
 expect(container.querySelector('textarea')).toBeNull();expect(container.textContent).not.toContain('Previously verified contact');expect(container.textContent).toContain('Retry');
});

it('lets a fenced HTTP read finish across transport loss without duplicate reconnect reads',async()=>{
 let complete!:(v:Snapshot)=>void;m.fetch.mockImplementationOnce(()=>new Promise<Snapshot>(resolve=>{complete=resolve;}));
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 act(()=>{m.event?.({type:'disconnected'});m.event?.({type:'reconnect'});});
 expect(container.querySelector('textarea')).not.toBeNull();
 await act(async()=>vi.advanceTimersByTimeAsync(250));expect(m.fetch).toHaveBeenCalledTimes(1);
 await act(async()=>complete(initial));expect(container.querySelector('textarea')).not.toBeNull();expect(m.fetch).toHaveBeenCalledTimes(1);
});
it('repeated SSE transport failures do not erase a new authorized read or cause a request storm',async()=>{
 await act(async()=>m.event?.({type:'disconnected'}));expect(m.fetch).toHaveBeenCalledTimes(1);
 for(let i=0;i<5;i++)await act(async()=>m.event?.({type:'disconnected'}));
 expect(m.fetch).toHaveBeenCalledTimes(1);expect(container.querySelector('textarea')).not.toBeNull();
});
it('bounds disconnected fallback reads and retries when the network returns',async()=>{
 await act(async()=>vi.advanceTimersByTimeAsync(30000*8));
 expect(m.fetch).toHaveBeenCalledTimes(5);
 await act(async()=>window.dispatchEvent(new Event('online')));
 expect(m.fetch).toHaveBeenCalledTimes(6);
});
it('keeps a verified draft during transport loss but hides it if the independent read denies access',async()=>{
 let finish!:(v:Snapshot)=>void;m.fetch.mockImplementationOnce(()=>new Promise<Snapshot>(resolve=>{finish=resolve;}));
 const draft=container.querySelector('textarea');
 act(()=>m.event?.({type:'disconnected'}));
 expect(container.querySelector('textarea')).toBe(draft);
 expect(draft?.value).toBe('Unsaved draft');
 await act(async()=>finish({ok:false,code:'FORBIDDEN'} as Snapshot));
 expect(container.querySelector('textarea')).toBeNull();
 expect(container.textContent).not.toContain('Previously verified contact');
});
it('keeps verified writes enabled on soft UNAVAILABLE without emptying the list',async()=>{
 const draft=container.querySelector('textarea');
 m.fetch.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'});
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(container.querySelector('[data-inbox-offline="true"]')).toBeNull();
 expect(container.querySelector('textarea')).toBe(draft);expect(container.querySelector('fieldset')?.disabled).toBe(false);
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.querySelector('fieldset')?.disabled).toBe(false);
});

it('does not schedule a second read when recovery precedes a fast pending read completion',async()=>{
 let complete!:(v:Snapshot)=>void;m.fetch.mockImplementationOnce(()=>new Promise<Snapshot>(resolve=>{complete=resolve;}));
 act(()=>m.event?.({type:'disconnected'}));act(()=>m.event?.({type:'reconnect'}));
 await act(async()=>complete(initial));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(m.fetch).toHaveBeenCalledTimes(1);expect(container.querySelector('textarea')).not.toBeNull();
});

it('starts the selected thread update before a slower list read completes and keeps its pane mounted',async()=>{
 let complete!:(v:Snapshot)=>void;m.fetch.mockImplementationOnce(()=>new Promise<Snapshot>(resolve=>{complete=resolve;}));
 const pane=container.querySelector('textarea');const initialVersion=m.threadVersions.at(-1)!;
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(m.fetch).toHaveBeenCalledTimes(1);expect(m.threadVersions.at(-1)).toBe(initialVersion+1);expect(container.querySelector('textarea')).toBe(pane);
 await act(async()=>complete(initial));expect(m.threadVersions.at(-1)).toBe(initialVersion+1);expect(container.querySelector('textarea')).toBe(pane);
});

it('a trailing list reconciliation does not reload a thread already refreshed for the event',async()=>{
 let finish!:(v:Snapshot)=>void;m.fetch.mockImplementationOnce(()=>new Promise<Snapshot>(resolve=>{finish=resolve;}));
 const initialVersion=m.threadVersions.at(-1)!;
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(m.threadVersions.at(-1)).toBe(initialVersion+2);
 await act(async()=>finish(initial));expect(m.fetch).toHaveBeenCalledTimes(2);
 expect(m.threadVersions.at(-1)).toBe(initialVersion+2);
});

it('uses the reference worklist and stage controls against loaded scoped rows without fetching or losing drafts',async()=>{
 if(!initial.ok||!initial.wa.ok)throw new Error('fixture');
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 const first={...row,status:'open',automationAllowed:false,assistantPaused:true,assignedTo:null,leadStage:'interested',unreadCount:1,followUpStatus:'scheduled',followUpAt:new Date(Date.now()-3600000).toISOString(),intervention:{reasons:[]},messages:[{from:'customer',at:Date.now(),text:'Question'}]};
 const second={...first,id:'second',customer:'Other scoped customer',leadStage:'new',unreadCount:0,followUpStatus:'none',followUpAt:null,messages:[]};
 const loaded={...initial,wa:{...initial.wa,conversations:[first,second],page:{...initial.wa.page,conversations:[first,second]}}} as unknown as Snapshot;
 act(()=>root.unmount());root=createRoot(container);
 await act(async()=>root.render(<UnifiedInbox initial={loaded}/>));
 const draft=container.querySelector('textarea');
 const stage=container.querySelector<HTMLSelectElement>('.vdi-filters select[aria-label="Filter lead stage"]')!;
 expect(stage).not.toBeNull();expect(stage.options).toHaveLength(7);
 const worklist=container.querySelector<HTMLSelectElement>('.vdi-filters select[aria-label="Worklist"]')!;
 expect([...worklist.options].map(option=>option.value)).toEqual(expect.arrayContaining(['all','unread','awaiting_staff','follow_up_today','overdue','trial_or_quote','noura','resolved']));
 expect(container.querySelectorAll('.vdi-conversation')).toHaveLength(2);
 act(()=>{stage.value='interested';stage.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(container.querySelectorAll('.vdi-conversation')).toHaveLength(1);expect(container.querySelector('.vdi-conversation')?.textContent).toContain('Previously verified contact');
 act(()=>{worklist.value='overdue';worklist.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(container.querySelectorAll('.vdi-conversation')).toHaveLength(1);
 expect([...worklist.options].find(option=>option.value==='overdue')?.textContent).toContain('(1)');
 expect(container.querySelector('textarea')).toBe(draft);expect(m.fetch).not.toHaveBeenCalled();
});
it('limits Instagram filters to supported queue fields and clears an unsupported deep-linked state',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 const previousParams=m.params;m.params=new URLSearchParams('channel=instagram&filter=resolved');
 try{
 const loaded={...initial,waAllowed:false,igAllowed:true,wa:{ok:false,code:'FORBIDDEN'},ig:{ok:true,data:{companyId:'company',actorId:'actor',conversationScope:'all_company',conversations:[{id:'instagram-thread',counterpartyId:'Scoped Instagram participant',unreadCount:1,assignedTo:null,lastReceivedAt:null}],hasMore:false,nextCursor:null}}} as unknown as Snapshot;
 act(()=>root.unmount());root=createRoot(container);
 await act(async()=>root.render(<UnifiedInbox initial={loaded}/>));
 const list=container.querySelector<HTMLSelectElement>('.vdi-filters select[aria-label="Worklist"]')!;
 expect([...list.options].map(option=>option.value)).toEqual(['all','unread']);expect(list.value).toBe('all');
 expect(container.querySelector('.vdi-filters select[aria-label="Filter lead stage"]')).toBeNull();
 expect(container.querySelector('.vdi-conversation')?.textContent).toContain('Scoped Instagram participant');expect(m.fetch).not.toHaveBeenCalled();
 }finally{m.params=previousParams;}
});

it('retains verified messages and draft on a classified transport outage, pauses actions, then revalidates',async()=>{
 const draft=container.querySelector('textarea');
 m.fetch.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE',transportUnavailable:true});
 act(()=>m.event?.({type:'disconnected'}));await act(async()=>Promise.resolve());
 expect(container.querySelector('textarea')).toBe(draft);expect(draft?.value).toBe('Unsaved draft');
 expect(container.textContent).toContain('Previously verified contact');expect(container.querySelector('fieldset')?.disabled).toBe(true);
 expect(container.textContent).not.toContain(appCopy('en').app.inboxLoadFailedBody);
 act(()=>m.event?.({type:'reconnect'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.querySelector('fieldset')?.disabled).toBe(false);
});
it('keeps the verified list mounted on soft UNAVAILABLE instead of the empty offline shell',async()=>{
 const draft=container.querySelector('textarea');
 m.fetch.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'});
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(container.querySelector('[data-inbox-offline="true"]')).toBeNull();
 expect(container.textContent).toContain('Previously verified contact');expect(container.querySelector('textarea')).toBe(draft);
 expect(container.querySelector('fieldset')?.disabled).toBe(false);
 expect(container.textContent).not.toContain(appCopy('en').app.inboxLoadFailedBody);
});
it('never revives prior data after explicit denial followed by a transport failure',async()=>{
 m.fetch.mockResolvedValueOnce({ok:false,code:'FORBIDDEN'});
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 m.fetch.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE',transportUnavailable:true});
 act(()=>m.event?.({type:'disconnected'}));await act(async()=>Promise.resolve());
 expect(container.querySelector('textarea')).toBeNull();expect(container.textContent).not.toContain('Previously verified contact');
});
it('pauses immediately on browser offline and waits for a verified read before resuming after online',async()=>{
 const draft=container.querySelector('textarea');
 act(()=>window.dispatchEvent(new Event('offline')));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.querySelector('fieldset')?.disabled).toBe(true);expect(m.fetch).not.toHaveBeenCalled();
 let finish!:(value:Snapshot)=>void;m.fetch.mockImplementationOnce(()=>new Promise<Snapshot>(resolve=>{finish=resolve;}));
 act(()=>window.dispatchEvent(new Event('online')));
 expect(m.fetch).toHaveBeenCalledTimes(1);expect(container.querySelector('fieldset')?.disabled).toBe(true);
 await act(async()=>finish(initial));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.querySelector('fieldset')?.disabled).toBe(false);
});

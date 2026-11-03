// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {InboxRealtimeEvent} from './branch-inbox-realtime';
const m=vi.hoisted(()=>({fetch:vi.fn(),event:null as null|((e:InboxRealtimeEvent)=>void),router:{refresh:vi.fn()},account:null as null|{status:'ready'|'locked';identity:{userId:string};boundaryFingerprint:string},params:new URLSearchParams('source=whatsapp&c=thread')}));
vi.mock('next/navigation',()=>({useRouter:()=>m.router}));
vi.mock('next/link',()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
vi.mock('@/lib/navigation/use-local-search-params',()=>({useLocalSearchParams:()=>[m.params,vi.fn()]}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en'})}));
vi.mock('@/lib/customer/service-inbox-read',()=>({fetchServiceInbox:m.fetch}));
vi.mock('@/lib/whatsapp/inbox-actions',()=>({refreshWhatsappInboxPage:vi.fn()}));
vi.mock('@/lib/instagram/inbox-actions',()=>({loadInstagramInboxPage:vi.fn()}));
vi.mock('./workspace-shell',()=>({WorkspaceShell:({children,actions}:{children:React.ReactNode;actions:React.ReactNode})=><main>{actions}{children}</main>}));
vi.mock('./ui',()=>({Button:({children,onClick,disabled}:{children:React.ReactNode;onClick:()=>void;disabled:boolean})=><button onClick={onClick} disabled={disabled}>{children}</button>,Notice:({children}:{children:React.ReactNode})=><aside>{children}</aside>,EmptyState:()=>null,useAppCopy:()=>({app:{inboxAccessDeniedTitle:"Denied",inboxAccessDeniedBody:"No access",inboxLoadFailedBody:"Unavailable"}})}));
vi.mock('./conversations',()=>({ConversationsPage:()=>{const [draft]=useState('Unsaved draft');return <textarea aria-label="Preserved draft" defaultValue={draft}/>;}}));
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
it('coalesces event bursts, retains the pane draft and suspends polling while connected',async()=>{
 const draft=container.querySelector('textarea');
 act(()=>{m.event?.({type:'ready'});for(let i=0;i<10;i++)m.event?.({type:'change'});});
 await act(async()=>vi.advanceTimersByTimeAsync(250));expect(m.fetch).toHaveBeenCalledTimes(1);
 await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(m.fetch).toHaveBeenCalledTimes(1);expect(container.querySelector('textarea')).toBe(draft);expect(draft?.value).toBe('Unsaved draft');
 act(()=>m.event?.({type:'unavailable'}));await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(m.fetch).toHaveBeenCalledTimes(2);
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
 await act(async()=>complete(initial));expect(container.querySelector('textarea')).toBeNull();expect(container.textContent).toContain('latest update could not be verified');
 const recovery=Array.from(container.querySelectorAll('a')).find(a=>a.textContent==='Reload page to verify');
 expect(recovery?.getAttribute('href')).toBe('/app/conversations?source=whatsapp&c=thread');
 expect(m.fetch).toHaveBeenCalledTimes(1);
});

it('retains the previously read pane only during UNAVAILABLE, disables actions, then recovers',async()=>{
 const draft=container.querySelector('textarea');
 m.fetch.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'});
 act(()=>m.event?.({type:'change'}));await act(async()=>vi.advanceTimersByTimeAsync(250));
 expect(container.querySelector('textarea')).toBe(draft);expect(container.textContent).toContain('Previously verified contact');
 expect(container.querySelector('fieldset')?.disabled).toBe(true);
 expect(container.querySelector('textarea')?.closest('[inert]')).not.toBeNull();
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

it('pauses actions immediately when the live permission stream becomes unavailable',()=>{
 const draft=container.querySelector('textarea');act(()=>m.event?.({type:'unavailable'}));expect(container.querySelector('textarea')).toBe(draft);expect(container.querySelector('fieldset')?.disabled).toBe(true);
});

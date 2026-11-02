// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {InboxRealtimeEvent} from './branch-inbox-realtime';
const m=vi.hoisted(()=>({fetch:vi.fn(),event:null as null|((e:InboxRealtimeEvent)=>void),router:{refresh:vi.fn()},params:new URLSearchParams('source=whatsapp&c=thread')}));
vi.mock('next/navigation',()=>({useRouter:()=>m.router}));
vi.mock('next/link',()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
vi.mock('@/lib/navigation/use-local-search-params',()=>({useLocalSearchParams:()=>[m.params,vi.fn()]}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en'})}));
vi.mock('@/lib/customer/service-inbox-read',()=>({fetchServiceInbox:m.fetch}));
vi.mock('@/lib/whatsapp/inbox-actions',()=>({refreshWhatsappInboxPage:vi.fn()}));
vi.mock('@/lib/instagram/inbox-actions',()=>({loadInstagramInboxPage:vi.fn()}));
vi.mock('./workspace-shell',()=>({WorkspaceShell:({children,actions}:{children:React.ReactNode;actions:React.ReactNode})=><main>{actions}{children}</main>}));
vi.mock('./ui',()=>({Button:({children,onClick,disabled}:{children:React.ReactNode;onClick:()=>void;disabled:boolean})=><button onClick={onClick} disabled={disabled}>{children}</button>,Notice:({children}:{children:React.ReactNode})=><aside>{children}</aside>,EmptyState:()=>null,useAppCopy:()=>({})}));
vi.mock('./conversations',()=>({ConversationsPage:()=>{const [draft]=useState('Unsaved draft');return <textarea aria-label="Preserved draft" defaultValue={draft}/>;}}));
vi.mock('./instagram-inbox',()=>({InstagramInbox:()=>null}));
vi.mock('./branch-inbox-realtime',()=>({CompanyInboxRealtime:({onInboxEvent}:{onInboxEvent:(e:InboxRealtimeEvent)=>void})=>{m.event=onInboxEvent;return null;}}));
import {UnifiedInbox} from './unified-inbox';
type Snapshot=React.ComponentProps<typeof UnifiedInbox>['initial'];
const initial={ok:true,companyId:'company',actorId:'actor',owner:true,companyInSetup:false,waAllowed:true,igAllowed:false,igAssignAllowed:false,channelContract:{plan_entitlements:{status:'UNCONFIGURED'}},channel_access:{whatsapp:true,instagram:false},wa:{ok:true,conversations:[],page:{companyId:'company',conversationScope:'all_company',kind:'partial',ordering:'newest_created',conversations:[],hasMore:false,nextCursor:null,total:0,unreadTotal:0,interventionTotal:0,membershipFingerprint:'same'},meta:{companyId:'company',conversationScope:'all_company',timezone:null,timezoneAnnouncedUtc:true,canReply:true,canAssign:false,assignees:[],counts:{}}},ig:{ok:false,code:'FORBIDDEN'}} as unknown as Snapshot;
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});m.fetch.mockResolvedValue(initial);container=document.createElement('div');document.body.append(container);root=createRoot(container);act(()=>root.render(<UnifiedInbox initial={initial}/>));});
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
});

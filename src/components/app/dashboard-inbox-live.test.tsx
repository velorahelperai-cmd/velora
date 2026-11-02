// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {InboxRealtimeEvent} from './branch-inbox-realtime';
const m=vi.hoisted(()=>({fetch:vi.fn(),event:null as null|((e:InboxRealtimeEvent)=>void)}));
vi.mock('@/lib/customer/service-inbox-read',()=>({fetchServiceInbox:m.fetch}));
vi.mock('./branch-inbox-realtime',()=>({CompanyInboxRealtime:({onInboxEvent}:{onInboxEvent:(e:InboxRealtimeEvent)=>void})=>{m.event=onInboxEvent;return null;}}));
import {DashboardInboxLive} from './dashboard-inbox-live';
const wa={ok:true,conversations:[],meta:{companyId:'company'}};
const result={ok:true,companyId:'company',actorId:'actor',waAllowed:true,wa};
let root:Root,host:HTMLDivElement;const update=vi.fn();
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});m.fetch.mockResolvedValue(result);host=document.createElement('div');root=createRoot(host);act(()=>root.render(<DashboardInboxLive companyId="company" actorId="actor" ar={false} onSnapshot={update}/>));});
afterEach(()=>{act(()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();});
const emit=async(type:InboxRealtimeEvent['type'])=>{act(()=>m.event?.({type}));await act(async()=>vi.advanceTimersByTimeAsync(250));};
it('refreshes from a scoped read, coalesces bursts and suspends fallback while connected',async()=>{
 act(()=>{m.event?.({type:'ready'});for(let i=0;i<8;i++)m.event?.({type:'change'});});
 await act(async()=>vi.advanceTimersByTimeAsync(250));expect(m.fetch).toHaveBeenCalledExactlyOnceWith({companyId:'company',actorId:'actor'});expect(update).toHaveBeenLastCalledWith(wa);
 await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(m.fetch).toHaveBeenCalledTimes(1);
 await emit('unavailable');await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(m.fetch).toHaveBeenCalledTimes(2);
});
it('retains one reconciliation when events arrive during a pending read',async()=>{
 let resolve!:(v:unknown)=>void;m.fetch.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 await emit('ready');await emit('change');await emit('change');expect(m.fetch).toHaveBeenCalledTimes(1);
 await act(async()=>resolve(result));expect(m.fetch).toHaveBeenCalledTimes(2);
});
it('revocation clears data and prevents a pending response from restoring it',async()=>{
 let resolve!:(v:unknown)=>void;m.fetch.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 await emit('ready');await emit('revoked');await act(async()=>resolve(result));
 expect(update).toHaveBeenCalledExactlyOnceWith({ok:false,code:'FORBIDDEN'});await emit('change');expect(m.fetch).toHaveBeenCalledTimes(1);
});
it('discards an old workspace response after changing scope',async()=>{
 let resolve!:(v:unknown)=>void;m.fetch.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await emit('ready');
 act(()=>root.render(<DashboardInboxLive companyId="new-company" actorId="actor" ar={false} onSnapshot={update}/>));
 await act(async()=>resolve(result));expect(update).not.toHaveBeenCalled();
});
it('fails closed for a mismatching read and channel denial',async()=>{
 m.fetch.mockResolvedValueOnce({...result,waAllowed:false});await emit('ready');expect(update).toHaveBeenLastCalledWith({ok:false,code:'FORBIDDEN'});
 m.fetch.mockResolvedValueOnce({...result,actorId:'foreign'});await emit('change');expect(update).toHaveBeenLastCalledWith({ok:false,code:'FORBIDDEN'});
 await emit('change');expect(m.fetch).toHaveBeenCalledTimes(2);
});
it('does not read hidden pages and reconciles when visible again',async()=>{
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});await emit('change');await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(m.fetch).not.toHaveBeenCalled();
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(m.fetch).toHaveBeenCalledTimes(1);
});

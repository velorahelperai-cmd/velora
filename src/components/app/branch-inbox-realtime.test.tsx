// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({router:{refresh:vi.fn()}}));
vi.mock('next/navigation',()=>({useRouter:()=>m.router}));
import {BranchInboxRealtime,CompanyInboxRealtime} from './branch-inbox-realtime';
class Source extends EventTarget{
 static CLOSED=2;
 static all:Source[]=[];
 readyState=0;
 close=vi.fn();onerror:(()=>void)|null=null;
 constructor(public url:string){super();Source.all.push(this);}
}
const props={companyId:'qa-company',branchId:'qa-main',channel:'whatsapp',ar:true};
let root:Root,container:HTMLDivElement;
function render(element:React.ReactNode){act(()=>root.render(element));return {rerender:(next:React.ReactNode)=>act(()=>root.render(next)),unmount:()=>act(()=>root.unmount())};}
const statusText=()=>container.querySelector('[role="status"]')?.textContent;
beforeEach(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});vi.clearAllMocks();vi.useFakeTimers();Source.all=[];vi.stubGlobal('EventSource',Source);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('refreshes on ready and coalesces a burst of changes without rendering event payloads',async()=>{
 render(<BranchInboxRealtime {...props}/>);const source=Source.all[0];
 expect(source.url).toContain('company=qa-company&branch=qa-main&channel=whatsapp');
 act(()=>{source.dispatchEvent(new Event('ready'));for(let i=0;i<5;i++)source.dispatchEvent(new MessageEvent('change',{data:'PRIVATE_BODY'}));});
 await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
 expect(m.router.refresh).toHaveBeenCalledTimes(1);expect(statusText()).toBe('التحديثات المباشرة متصلة');expect(document.body.textContent).not.toContain('PRIVATE_BODY');
});
it('closes stale scope subscriptions and cancels pending refreshes on unmount',async()=>{
 const view=render(<BranchInboxRealtime key="main" {...props}/>),old=Source.all[0];
 act(()=>{old.dispatchEvent(new Event('change'));});
 view.rerender(<BranchInboxRealtime key="other" {...props} branchId="qa-branch-2"/>);
 expect(old.close).toHaveBeenCalledTimes(1);
 await act(async()=>{old.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(250);});
 expect(m.router.refresh).not.toHaveBeenCalled();
 act(()=>{Source.all[1].dispatchEvent(new Event('change'));});view.unmount();
 await vi.advanceTimersByTimeAsync(250);expect(m.router.refresh).not.toHaveBeenCalled();expect(Source.all[1].close).toHaveBeenCalledTimes(1);
});
it('revalidates on revocation and reconnect failure without leaving the stream active',async()=>{
 render(<BranchInboxRealtime {...props}/>);const source=Source.all[0];
 act(()=>{source.dispatchEvent(new Event('ready'));source.dispatchEvent(new Event('revoked'));});
 await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
 expect(source.close).toHaveBeenCalledTimes(1);expect(m.router.refresh).toHaveBeenCalledTimes(1);expect(statusText()).toContain('جارٍ الاتصال');
 await act(async()=>{source.readyState=Source.CLOSED;source.onerror?.();await vi.advanceTimersByTimeAsync(5000);});expect(Source.all).toHaveLength(1);
});
it('recreates terminal transport failures after backoff and cancels retries when unmounted',async()=>{
 const view=render(<BranchInboxRealtime {...props}/>),source=Source.all[0];
 act(()=>{source.readyState=Source.CLOSED;source.onerror?.();});
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(Source.all).toHaveLength(2);expect(source.close).toHaveBeenCalledTimes(1);
 act(()=>{Source.all[1].dispatchEvent(new Event('ready'));});expect(statusText()).toBe('التحديثات المباشرة متصلة');
 act(()=>{Source.all[1].readyState=Source.CLOSED;Source.all[1].onerror?.();});view.unmount();
 await vi.advanceTimersByTimeAsync(5000);expect(Source.all).toHaveLength(2);
});
it('calls onInboxEvent directly without calling router.refresh on change',async()=>{
 const onInboxEvent=vi.fn();
 render(<BranchInboxRealtime {...props} onInboxEvent={onInboxEvent}/>);
 const source=Source.all[0];
 act(()=>{source.dispatchEvent(new Event('ready'));});
 expect(onInboxEvent).toHaveBeenCalledWith({type:'ready'});
 expect(m.router.refresh).not.toHaveBeenCalled();
 act(()=>{source.dispatchEvent(new MessageEvent('change',{data:JSON.stringify({company_id:'qa-company'})}));});
 expect(onInboxEvent).toHaveBeenCalledWith({type:'change',data:{company_id:'qa-company'}});
 expect(m.router.refresh).not.toHaveBeenCalled();
});
it('reports transport loss to the inbox so fallback reads can resume',()=>{
 const onInboxEvent=vi.fn();render(<BranchInboxRealtime {...props} onInboxEvent={onInboxEvent}/>);
 act(()=>Source.all[0].dispatchEvent(new Event('ready')));onInboxEvent.mockClear();
 act(()=>Source.all[0].dispatchEvent(new Event('unavailable')));
 expect(onInboxEvent).toHaveBeenCalledWith({type:'unavailable'});
});
it('ignores queued events from a replaced transport',async()=>{
 const onInboxEvent=vi.fn();render(<BranchInboxRealtime {...props} onInboxEvent={onInboxEvent}/>);
 const old=Source.all[0];act(()=>{old.readyState=Source.CLOSED;old.onerror?.();});
 await act(async()=>vi.advanceTimersByTimeAsync(5000));onInboxEvent.mockClear();
 act(()=>{old.dispatchEvent(new Event('ready'));old.dispatchEvent(new Event('revoked'));old.dispatchEvent(new MessageEvent('change',{data:'{}'}));});
 expect(onInboxEvent).not.toHaveBeenCalled();expect(Source.all[1].close).not.toHaveBeenCalled();
});
it('binds company subscriptions to the actor and never treats visibility as transport recovery',()=>{
 const onInboxEvent=vi.fn();const view=render(<CompanyInboxRealtime separateTransport companyId="company" actorId="actor" ar={false} onInboxEvent={onInboxEvent}/>);
 const old=Source.all[0];expect(old.url).toBe('/api/inbox/events?companyId=company&actorId=actor');
 act(()=>old.dispatchEvent(new Event('ready')));expect(statusText()).toBe('Live updates connected');
 act(()=>old.dispatchEvent(new Event('unavailable')));onInboxEvent.mockClear();
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});act(()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(onInboxEvent).not.toHaveBeenCalled();expect(statusText()).not.toBe('Live updates connected');
 view.rerender(<CompanyInboxRealtime separateTransport companyId="company" actorId="new-actor" ar={false} onInboxEvent={onInboxEvent}/>);
 expect(old.close).toHaveBeenCalledOnce();expect(Source.all[1].url).toContain('actorId=new-actor');
});
it('closes hidden-tab transports and reconnects once on return',()=>{
 const onInboxEvent=vi.fn();render(<CompanyInboxRealtime separateTransport companyId="company" actorId="actor" ar={false} onInboxEvent={onInboxEvent}/>);
 const old=Source.all[0];act(()=>old.dispatchEvent(new Event('ready')));
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});act(()=>document.dispatchEvent(new Event('visibilitychange')));expect(old.close).toHaveBeenCalledOnce();
 onInboxEvent.mockClear();act(()=>old.dispatchEvent(new MessageEvent('change',{data:'{}'})));expect(onInboxEvent).not.toHaveBeenCalled();
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});act(()=>document.dispatchEvent(new Event('visibilitychange')));expect(Source.all).toHaveLength(2);
 act(()=>Source.all[1].dispatchEvent(new Event('ready')));expect(onInboxEvent).toHaveBeenCalledWith({type:'reconnect'});
});

it('owns CONNECTING retries with bounded exponential jitter and ignores closed sources',async()=>{
 const random=vi.spyOn(Math,'random').mockReturnValue(0.5);
 try{
  const event=vi.fn();render(<CompanyInboxRealtime separateTransport companyId="c" actorId="a" ar={false} onInboxEvent={event}/>);
  for(let attempt=0;attempt<6;attempt++){
   const source=Source.all.at(-1)!;
   act(()=>source.onerror?.());expect(source.close).toHaveBeenCalledOnce();
   expect(event).toHaveBeenCalledWith({type:'disconnected'});
   const count=Source.all.length;
   if(attempt<5){
    const delay=1000*2**attempt;
    await act(async()=>vi.advanceTimersByTimeAsync(delay-1));expect(Source.all).toHaveLength(count);
    await act(async()=>vi.advanceTimersByTimeAsync(1));expect(Source.all).toHaveLength(count+1);
   }else{await act(async()=>vi.advanceTimersByTimeAsync(120000));expect(Source.all).toHaveLength(count);}
  }
 }finally{random.mockRestore();}
});

it('rotates freshly authorized streams without reporting a false disconnect',async()=>{
 const onInboxEvent=vi.fn();render(<CompanyInboxRealtime separateTransport companyId="c" actorId="a" ar={false} onInboxEvent={onInboxEvent}/>);
 const source=Source.all[0];act(()=>source.dispatchEvent(new Event('ready')));onInboxEvent.mockClear();
 act(()=>source.dispatchEvent(new Event('renew')));expect(source.close).toHaveBeenCalledOnce();expect(onInboxEvent).not.toHaveBeenCalled();
 await act(async()=>vi.advanceTimersByTimeAsync(500));expect(Source.all).toHaveLength(2);
 act(()=>Source.all[1].dispatchEvent(new Event('ready')));expect(onInboxEvent).toHaveBeenCalledWith({type:'reconnect'});
});

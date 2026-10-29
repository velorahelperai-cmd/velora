import {afterEach,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {branchInboxEventStream} from './branch-inbox-events';
const scope={companyId:'10000000-0000-4000-8000-000000000021',branchId:'10000000-0000-4000-8000-000000000031',channel:'whatsapp'};
function setup(authorize=vi.fn(async()=>true)){
 vi.useFakeTimers();
 let status:(v:string)=>void=()=>{};
 const handlers:Array<(p:never)=>void>=[];
 const channel={on:vi.fn((_event,_filter,handler)=>{handlers.push(handler);return channel;}),subscribe:vi.fn(fn=>{status=fn;})};
 const client={channel:vi.fn(()=>channel),removeChannel:vi.fn(async()=> 'ok')};
 const abort=new AbortController();
 const response=branchInboxEventStream({client:client as unknown as SupabaseClient,scope,authorize,signal:abort.signal,heartbeatMs:100,lifetimeMs:1000});
 const reader=response.body!.getReader(),read=async()=>new TextDecoder().decode((await reader.read()).value);
 return {authorize,client,abort,response,reader,read,status:(s:string)=>status(s),ready:()=>{status('SUBSCRIBED');handlers[2]({extension:'postgres_changes',status:'ok'} as never);},changed:(p:{new:Record<string,unknown>})=>handlers[0](p as never)};
}
afterEach(()=>{vi.useRealTimers();});
it('emits empty signals only for the authorized scope and cleans up on abort',async()=>{
 const s=setup();expect(s.response.headers.get('cache-control')).toContain('no-store');
 expect(await s.read()).toContain('retry: 5000');
 s.status('SUBSCRIBED');expect(s.authorize).not.toHaveBeenCalled();s.ready();expect(await s.read()).toBe('event: ready\ndata: {}\n\n');
 s.changed({new:{company_id:'foreign',branch_id:scope.branchId,channel:scope.channel}});
 expect(s.authorize).toHaveBeenCalledTimes(1);
 s.changed({new:{company_id:scope.companyId,branch_id:scope.branchId,channel:scope.channel,body:'PRIVATE_BODY',token:'PRIVATE_TOKEN'}});
 expect(await s.read()).toBe('event: change\ndata: {}\n\n');
 s.abort.abort();expect((await s.reader.read()).done).toBe(true);expect(s.client.removeChannel).toHaveBeenCalledTimes(1);
});
it('rechecks idle authority and closes on revocation without another change',async()=>{
 const authorize=vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false),s=setup(authorize);
 await s.read();s.ready();await s.read();
 await vi.advanceTimersByTimeAsync(100);
 expect(await s.read()).toBe('event: revoked\ndata: {}\n\n');
 expect((await s.reader.read()).done).toBe(true);expect(s.client.removeChannel).toHaveBeenCalledTimes(1);
});
it('cleans up upstream errors, cancellation and the bounded connection lifetime',async()=>{
 for(const end of ['error','cancel','lifetime']){
  const s=setup();await s.read();
  if(end==='error'){s.status('CHANNEL_ERROR');expect(await s.read()).toContain('unavailable');}
  else if(end==='cancel')await s.reader.cancel();
  else await vi.advanceTimersByTimeAsync(1000);
  expect((await s.reader.read()).done).toBe(true);expect(s.client.removeChannel).toHaveBeenCalledTimes(1);
 }
});
it('retains a change received during an in-flight authorization check',async()=>{
 let release:(v:boolean)=>void=()=>{};
 const authorize=vi.fn().mockImplementationOnce(()=>new Promise<boolean>(r=>{release=r;})).mockResolvedValue(true);
 const s=setup(authorize);await s.read();s.ready();
 s.changed({new:{company_id:scope.companyId,branch_id:scope.branchId,channel:scope.channel}});
 release(true);expect(await s.read()).toContain('ready');expect(await s.read()).toContain('change');
 s.abort.abort();
});

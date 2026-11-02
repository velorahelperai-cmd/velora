import {afterEach,describe,expect,it,vi} from 'vitest';
import {accountReadFetch,runAccountReadRequest,ACCOUNT_READ_TIMEOUT_MS} from './account-read-request';
vi.mock('server-only',()=>({}));
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
const url='https://example.invalid/rest/v1/rpc/vel_broker_capability_probe';
function hangingFetch(){
 return vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
  init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});
 }));
}
describe('account read transport lifetime',()=>{
 it('leaves calls outside the account request unchanged',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetcher);
  const init={method:'POST',body:'{}'};
  await accountReadFetch(url,init);
  expect(fetcher).toHaveBeenCalledWith(url,init);
 });
 it('aborts an in-flight broker read when the caller disconnects',async()=>{
  const fetcher=hangingFetch();vi.stubGlobal('fetch',fetcher);const caller=new AbortController();
  const work=runAccountReadRequest(caller.signal,()=>accountReadFetch(url,{method:'POST'}));
  const rejection=expect(work).rejects.toMatchObject({name:'AbortError'});
  caller.abort();await rejection;expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('bounds a stalled read at 30 seconds and prevents follow-up reads',async()=>{
  vi.useFakeTimers();const fetcher=hangingFetch();vi.stubGlobal('fetch',fetcher);
  const work=runAccountReadRequest(new AbortController().signal,async()=>{
   try{await accountReadFetch(url,{method:'POST'});}catch{}
   return accountReadFetch('https://example.invalid/rest/v1/profiles');
  });
  const rejection=expect(work).rejects.toMatchObject({name:'TimeoutError'});
  await vi.advanceTimersByTimeAsync(ACCOUNT_READ_TIMEOUT_MS);await rejection;
  expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
 it('preserves a caller-provided fetch abort signal',async()=>{
  const fetcher=hangingFetch();vi.stubGlobal('fetch',fetcher);const original=new AbortController();
  const work=runAccountReadRequest(new AbortController().signal,()=>accountReadFetch(url,{method:'POST',signal:original.signal}));
  const rejection=expect(work).rejects.toMatchObject({name:'AbortError'});
  original.abort();await rejection;
 });
 it('does not dispatch an already cancelled request',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const caller=new AbortController();caller.abort();
  await expect(runAccountReadRequest(caller.signal,()=>accountReadFetch(url))).rejects.toMatchObject({name:'AbortError'});
  expect(fetcher).not.toHaveBeenCalled();
 });
 it.each(['/rest/v1/rpc/vel_broker_claim_refresh','/rest/v1/rpc/unknown_write','/auth/v1/token'])('preserves mutation transport for %s',async path=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetcher);
  const init={method:'POST',body:'{}'};const target='https://example.invalid'+path;
  await runAccountReadRequest(new AbortController().signal,()=>accountReadFetch(target,init));
  expect(fetcher).toHaveBeenCalledWith(target,init);
 });
 it('isolates concurrent requests and clears timers after success',async()=>{
  const signals:AbortSignal[]=[];const finish:Array<(r:Response)=>void>=[];
  vi.stubGlobal('fetch',vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((resolve,reject)=>{
   signals.push(init!.signal!);finish.push(resolve);init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});
  })));
  const a=new AbortController(),b=new AbortController();
  const first=runAccountReadRequest(a.signal,()=>accountReadFetch(url,{method:'POST'}));
  const firstRejected=expect(first).rejects.toMatchObject({name:'AbortError'});
  const second=runAccountReadRequest(b.signal,()=>accountReadFetch(url,{method:'POST'}));
  a.abort();await firstRejected;expect(signals[1].aborted).toBe(false);
  finish[1](new Response('{}'));expect((await second).status).toBe(200);
 });
});

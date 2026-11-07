import 'server-only';
import {AsyncLocalStorage} from 'node:async_hooks';

// Individual account GET/RPC lifetime. Must fit inside SESSION_READ_BUDGET_MS for one hop.
export const ACCOUNT_READ_TIMEOUT_MS=60_000;
const activeRead=new AsyncLocalStorage<AbortSignal>();
const readRpcs=new Set([
 'vel_broker_capability_probe',
 'vel_broker_resolve_bound_session',
 'vel_broker_lookup_browser_continuity',
 'check_app_session',
 'is_platform_admin',
]);

/** Transport lifetime only. Never caches authority, retries, or grants access. */
export async function runAccountReadRequest<T>(signal:AbortSignal,work:()=>Promise<T>):Promise<T>{
 const deadline=new AbortController();
 const timer=setTimeout(()=>deadline.abort(new DOMException('Account read timed out','TimeoutError')),ACCOUNT_READ_TIMEOUT_MS);
 const combined=AbortSignal.any([signal,deadline.signal]);
 try{
  combined.throwIfAborted();
  return await activeRead.run(combined,async()=>{
   const value=await work();
   combined.throwIfAborted();
   return value;
  });
 }finally{clearTimeout(timer);deadline.abort();}
}

/** Only account-read GET/HEAD and the explicit session/identity RPCs inherit abort.
 * Unknown POST RPCs and Auth writes keep their original transport/outcome rules.
 * Outside the opted-in request scope this is precisely the normal fetch call.
 */
export function accountReadFetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response>{
 const scope=activeRead.getStore();
 if(!scope)return fetch(input,init);
 const request=input instanceof Request?input:null;
 const method=(init?.method??request?.method??'GET').toUpperCase();
 let eligible=method==='GET'||method==='HEAD';
 if(method==='POST'){
  try{
   const path=new URL(request?.url??String(input)).pathname;
   eligible=path.startsWith('/rest/v1/rpc/')&&readRpcs.has(path.slice('/rest/v1/rpc/'.length));
  }catch{eligible=false;}
 }
 if(!eligible)return fetch(input,init);
 scope.throwIfAborted();
 const original=init?.signal===undefined?request?.signal:init.signal;
 const signal=original?AbortSignal.any([scope,original]):scope;
 signal.throwIfAborted();
 return fetch(input,{...init,signal});
}

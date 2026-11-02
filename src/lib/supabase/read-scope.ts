import 'server-only';
import {AsyncLocalStorage} from 'node:async_hooks';

const pendingReads=new AsyncLocalStorage<Map<string,Promise<unknown>>>();

/** Each read operation owns its pending work; never shared across requests. */
export function runWithReadScope<T>(work:()=>Promise<T>):Promise<T>{
 return pendingReads.run(new Map(),work);
}

/** Only coalesce overlapping calls. Completed authority is never cached here. */
export async function coalesceBrokerRead<T>(cookieSnapshot:string,work:()=>Promise<T>):Promise<T>{
 const scope=pendingReads.getStore();
 if(!scope)return work();
 const existing=scope.get(cookieSnapshot);
 if(existing)return existing as Promise<T>;
 const pending=Promise.resolve().then(work);
 scope.set(cookieSnapshot,pending);
 try{return await pending;}
 finally{if(scope.get(cookieSnapshot)===pending)scope.delete(cookieSnapshot);}
}

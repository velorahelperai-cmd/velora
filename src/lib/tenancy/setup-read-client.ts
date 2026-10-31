import type {SetupReads,SetupReadScope} from './setup-read-types';

export type SetupReadFailureKind='auth'|'scope'|'unavailable'|'network';
export class SetupReadError extends Error {
 constructor(public readonly kind:SetupReadFailureKind,public readonly resource:keyof SetupReads,public readonly stage:string|null=null,public readonly requestId:string|null=null,public readonly status?:number){super(status?`SETUP_READ_${status}`:`SETUP_READ_${kind.toUpperCase()}`);}
}

/** Each mounted branch owns its coordinator. Hours may be retained briefly
 * as a read-only preview; consumers must revalidate before enabling a save.
 * Knowledge and language may be reused for 30 seconds and shown only as a read-only preview for five minutes while revalidating. No settled identity, launch, billing or conversation cache. */
export function createSetupReader(scope:SetupReadScope,isCurrent:()=>boolean){
 const pending=new Map<keyof SetupReads,{promise:Promise<unknown>;controller:AbortController}>();
 const versions=new Map<keyof SetupReads,number>();
 const settled=new Map<keyof SetupReads,{value:unknown;at:number}>();
 let hoursPreview:{value:SetupReads['hours'];at:number}|null=null;
 let prefetched=false;
 function invalidate(resources?:readonly (keyof SetupReads)[]){
  const keys=resources??Array.from(new Set([...pending.keys(),...settled.keys(),'hours' as const]));
  for(const key of keys){versions.set(key,(versions.get(key)??0)+1);pending.get(key)?.controller.abort();pending.delete(key);settled.delete(key);}
  if(!resources||resources.includes('hours')){hoursPreview=null;prefetched=false;}
 }
 function peek<K extends 'knowledge'|'language'>(resource:K):SetupReads[K]|null{
  if(!isCurrent()){invalidate();return null;}
  const cached=settled.get(resource);
  if(cached&&Date.now()-cached.at<300_000)return cached.value as SetupReads[K];
  settled.delete(resource);return null;
 }
 function peekHours(){
  if(!isCurrent()){invalidate();return null;}
  if(hoursPreview&&Date.now()-hoursPreview.at<30_000)return hoursPreview.value;
  hoursPreview=null;return null;
 }
 function prefetchHours(){
  const connection=typeof navigator==='undefined'?null:(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
  if(prefetched||peekHours()||connection?.saveData||connection?.effectiveType?.includes('2g'))return;
  prefetched=true;void read('hours').catch(()=>{});
 }
 function read<K extends keyof SetupReads>(resource:K):Promise<SetupReads[K]>{
  if(!isCurrent()){invalidate();return Promise.reject(new Error('SCOPE_CHANGED'));}
  const cached=settled.get(resource);
  if(cached&&Date.now()-cached.at<30_000){
   const captured=versions.get(resource)??0;
   return Promise.resolve().then(()=>{if(captured!==(versions.get(resource)??0)||!isCurrent())throw new Error('SCOPE_CHANGED');return cached.value as SetupReads[K];});
  }
  if(cached&&Date.now()-cached.at>=300_000)settled.delete(resource);
  const existing=pending.get(resource);
  if(existing)return existing.promise as Promise<SetupReads[K]>;
  const captured=versions.get(resource)??0,controller=new AbortController();
  const query=new URLSearchParams({resource,expectedAccountId:scope.expectedAccountId,companyId:scope.companyId,branchId:scope.branchId});
  const promise=fetch(`/api/setup/read?${query}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'x-velora-boundary':scope.boundaryFingerprint}})
   .then(async response=>{
    if(response.status===401||response.status===403)invalidate();
    if(!response.ok){
     const stage=response.headers.get('x-setup-stage'),id=response.headers.get('x-request-id');
     throw new SetupReadError(response.status===401?'auth':response.status===403?'scope':'unavailable',resource,['validation','identity','scope','reader'].includes(stage??'')?stage:null,id&&/^[0-9a-f-]{36}$/i.test(id)?id:null,response.status);
    }
    const body=await response.json();
    if(captured!==(versions.get(resource)??0)||!isCurrent())throw new Error('SCOPE_CHANGED');
    if((resource==='knowledge'||resource==='language')&&body.data!=null)settled.set(resource,{value:body.data,at:Date.now()});
    if(resource==='hours')hoursPreview=body.data?.ok===true?{value:body.data as SetupReads['hours'],at:Date.now()}:null;
    return body.data as SetupReads[K];
   }).catch(error=>{
    if(error instanceof SetupReadError||error?.name==='AbortError'||error?.message==='SCOPE_CHANGED')throw error;
    throw new SetupReadError('network',resource);
   }).finally(()=>{if(pending.get(resource)?.promise===promise)pending.delete(resource);});
  pending.set(resource,{promise,controller});
  return promise;
 }
 return {read,invalidate,peek,peekHours,prefetchHours};
}
export type SetupReader=ReturnType<typeof createSetupReader>;

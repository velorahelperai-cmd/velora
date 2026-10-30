import type {SetupReads,SetupReadScope} from './setup-read-types';

/** Each mounted branch owns its coordinator. Only hours may be retained briefly
 * as a read-only preview; consumers must revalidate before enabling a save.
 * No settled identity, launch, billing, knowledge or conversation cache. */
export function createSetupReader(scope:SetupReadScope,isCurrent:()=>boolean){
 const pending=new Map<keyof SetupReads,{promise:Promise<unknown>;controller:AbortController}>();
 let generation=0;
 let hoursPreview:{value:SetupReads['hours'];at:number}|null=null;
 let prefetched=false;
 function invalidate(){generation++;for(const entry of pending.values())entry.controller.abort();pending.clear();hoursPreview=null;prefetched=false;}
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
  const existing=pending.get(resource);
  if(existing)return existing.promise as Promise<SetupReads[K]>;
  const captured=generation,controller=new AbortController();
  const query=new URLSearchParams({resource,expectedAccountId:scope.expectedAccountId,companyId:scope.companyId,branchId:scope.branchId});
  const promise=fetch(`/api/setup/read?${query}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'x-velora-boundary':scope.boundaryFingerprint}})
   .then(async response=>{
    if(response.status===401||response.status===403)invalidate();
    if(!response.ok)throw new Error(`SETUP_READ_${response.status}`);
    const body=await response.json();
    if(captured!==generation||!isCurrent())throw new Error('SCOPE_CHANGED');
    if(resource==='hours')hoursPreview=body.data?.ok===true?{value:body.data as SetupReads['hours'],at:Date.now()}:null;
    return body.data as SetupReads[K];
   }).finally(()=>{if(pending.get(resource)?.promise===promise)pending.delete(resource);});
  pending.set(resource,{promise,controller});
  return promise;
 }
 return {read,invalidate,peekHours,prefetchHours};
}
export type SetupReader=ReturnType<typeof createSetupReader>;

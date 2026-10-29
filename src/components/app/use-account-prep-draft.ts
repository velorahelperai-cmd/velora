"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {readAccountPrepDraft,saveAccountPrepDraft} from '@/lib/tenancy/account-prep-draft-actions';
import {
  accountPrepPayloadsEqual,
  parseAccountPrepDraftPatch,
  type AccountPrepDraftCode,
  type AccountPrepDraftPayload,
  type AccountPrepDraftRecord,
  type AccountPrepDraftResult,
  type AccountPrepSaveStatus,
} from '@/lib/tenancy/account-prep-draft';

type InFlight = {
  payload: AccountPrepDraftPayload;
  promise: Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>;
  editGen: number;
};

/** Shared account draft controller. Readback is not a second write; native CAS stays authoritative. */
export function useAccountPrepDraft({accountId,captureToken='',isCurrent,restore}:{accountId:string;captureToken?:string;isCurrent:()=>boolean;restore:(payload:AccountPrepDraftPayload)=>void}){
 const storageKey='velora:account-prep:v1:'+accountId;
 const localBase=useRef<{version:number;draftId:string}|null>(null);
 const recovered=useRef(false),syncRequested=useRef(false);
 const localPayload=useRef<AccountPrepDraftPayload|null>(null);
 const [localSaved,setLocalSaved]=useState(false);
 const scope=accountId+':'+captureToken;
 const callbacks=useRef({isCurrent,restore});
 const live=useRef(false),liveScope=useRef(scope),readEpoch=useRef(0);
 const record=useRef<AccountPrepDraftRecord|null>(null);
 const confirmed=useRef<AccountPrepDraftPayload|null>(null);
 const lastPatch=useRef<AccountPrepDraftPayload|null>(null);
 const loaded=useRef(false),blocked=useRef<AccountPrepDraftCode|null>(null);
 const dirty=useRef(false),editGen=useRef(0);
 const inFlight=useRef<InFlight|null>(null);
 const queued=useRef<AccountPrepDraftPayload|null>(null);
 const checkpointTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const writeRunner=useRef<(patch:AccountPrepDraftPayload)=>Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>>(()=>Promise.resolve(null));
 const [hydration,setHydration]=useState({scope,kind:'loading' as 'loading'|'ready'|'error'});
 const [saved,setSaved]=useState({scope,status:'idle' as AccountPrepSaveStatus,code:null as AccountPrepDraftCode|null});
 useLayoutEffect(()=>{callbacks.current={isCurrent,restore};},[isCurrent,restore]);
 useLayoutEffect(()=>{
  live.current=true;liveScope.current=scope;record.current=null;confirmed.current=null;lastPatch.current=null;loaded.current=false;blocked.current=null;
  dirty.current=false;editGen.current=0;inFlight.current=null;queued.current=null;readEpoch.current++;
  recovered.current=false;syncRequested.current=false;localPayload.current=null;localBase.current=null;
  queueMicrotask(()=>{
  if(!live.current||liveScope.current!==scope)return;
  setLocalSaved(false);
  try {
   const raw=JSON.parse(window.localStorage.getItem(storageKey)??'null');
   if(callbacks.current.isCurrent() && raw?.accountId===accountId && raw.schema===1 && raw.expiresAt>Date.now()){
    const parsed=parseAccountPrepDraftPatch({...raw.payload,website:null});
    const website=raw.payload?.website;
    if(parsed.ok && (website==null || website.kind==='none' || (website.kind==='url' && typeof website.value==='string' && website.value.length<=200))){
     const payload={...parsed.value,website};localPayload.current=payload;
     localBase.current=raw.base;recovered.current=raw.pending===true;dirty.current=recovered.current;
     if(recovered.current){lastPatch.current=payload;syncRequested.current=true;}
     callbacks.current.restore(payload);setLocalSaved(true);
    }
   }
  }catch{/* Storage unavailable/corrupt: retain editable in-memory form. */}
  setHydration({scope,kind:'ready'});
  });
  return()=>{live.current=false;if(checkpointTimer.current)clearTimeout(checkpointTimer.current);};
 },[scope,accountId,storageKey]);
 const ours=useCallback(()=>liveScope.current===scope&&callbacks.current.isCurrent(),[scope]);
 const valid=useCallback(()=>live.current&&ours(),[ours]);
 const publish=useCallback((status:AccountPrepSaveStatus,code:AccountPrepDraftCode|null)=>{
  if(live.current&&liveScope.current===scope)setSaved({scope,status,code});
 },[scope]);
 const persist=useCallback((payload:AccountPrepDraftPayload,pending:boolean)=>{
  if(!valid())return;
  localPayload.current=payload;
  try{window.localStorage.setItem(storageKey,JSON.stringify({schema:1,accountId,payload,pending,base:localBase.current,expiresAt:Date.now()+30*24*60*60*1000}));if(live.current)setLocalSaved(true);}
  catch{if(live.current)setLocalSaved(false);}
 },[accountId,valid,storageKey]);
 const checkpoint=useCallback((payload:AccountPrepDraftPayload)=>{
  if(!valid()||!dirty.current)return;
  const merged={...localPayload.current,...payload};
  lastPatch.current=merged;persist(merged,true);syncRequested.current=true;
  if(checkpointTimer.current)clearTimeout(checkpointTimer.current);
  checkpointTimer.current=setTimeout(()=>{
   checkpointTimer.current=null;
   if(!valid()||!loaded.current||blocked.current||!lastPatch.current||!parseAccountPrepDraftPatch(lastPatch.current).ok)return;
   if(inFlight.current){queued.current=lastPatch.current;return;}
   syncRequested.current=false;void writeRunner.current(lastPatch.current);
  },800);
 },[persist,valid]);
 const load=useCallback((explicit:boolean):Promise<boolean>=>{
  if(!valid()||inFlight.current)return Promise.resolve(false);
  const epoch=++readEpoch.current;loaded.current=false;if(explicit){dirty.current=false;editGen.current++;recovered.current=false;}
  return Promise.resolve().then(()=>readAccountPrepDraft(accountId)).then(result=>{
   if(!ours()||epoch!==readEpoch.current)return false;
   if(!result.ok){blocked.current=result.code;publish('fail',result.code);return false;}
   if(result.data&&result.data.accountId!==accountId){publish('fail','UNAVAILABLE');return false;}
   if(recovered.current && result.data && (!localBase.current || result.data.version!==localBase.current.version || result.data.draftId!==localBase.current.draftId) && !accountPrepPayloadsEqual(result.data.payload,lastPatch.current??{})){
    blocked.current='CONFLICT';publish('fail','CONFLICT');return false;
   }
   recovered.current=false;
   record.current=result.data;loaded.current=true;blocked.current=null;
   localBase.current=result.data?{version:result.data.version,draftId:result.data.draftId}:null;
   confirmed.current=result.data?result.data.payload:null;
   if(result.data&&!dirty.current){callbacks.current.restore(result.data.payload);persist(result.data.payload,false);}
   if(live.current)setHydration({scope,kind:'ready'});publish(result.data?'ok':'idle',null);
   if(syncRequested.current)queueMicrotask(()=>{
    const patch=lastPatch.current;
    if(valid() && syncRequested.current && !inFlight.current && patch && parseAccountPrepDraftPatch(patch).ok){syncRequested.current=false;void writeRunner.current(patch);}
   });
   return true;
  }).catch(()=>{if(ours()&&epoch===readEpoch.current){publish('fail','UNAVAILABLE');}return false;});
 },[accountId,ours,persist,publish,scope,valid]);
 useEffect(()=>{void load(false);},[load]);
 const reload=useCallback(()=>{if(!valid()||inFlight.current)return Promise.resolve(false);return load(true);},[load,valid]);
 const markEdited=useCallback(()=>{if(valid()){dirty.current=true;editGen.current++;}},[valid]);
 const hasUnconfirmedChanges=useCallback(()=>dirty.current||Boolean(inFlight.current)||Boolean(queued.current),[ ]);
 useEffect(()=>{
  if(typeof window==='undefined'||typeof window.addEventListener!=='function')return;
  const warn=(event:BeforeUnloadEvent)=>{if(!hasUnconfirmedChanges()||localSaved)return;event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[hasUnconfirmedChanges,localSaved]);

 useLayoutEffect(()=>{writeRunner.current=(patch:AccountPrepDraftPayload):Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>=>{
  if(!ours())return Promise.resolve(null);
  if(!loaded.current||blocked.current){const code=blocked.current??'UNAVAILABLE';publish('fail',code);return Promise.resolve({ok:false,code});}
  syncRequested.current=false;
  const startedEdit=editGen.current;
  lastPatch.current=patch;
  publish('idle',null);
  const prior=record.current;
  const work=(async():Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>=>{
   let result:AccountPrepDraftResult<AccountPrepDraftRecord>;
   try{result=await saveAccountPrepDraft({expectedAccountId:accountId,expectedVersion:prior?.version??0,patch,...(prior?{draftId:prior.draftId}:{})});}
   catch{result={ok:false,code:'UNAVAILABLE'};}
   if(!ours())return null;
   if(result.ok&&result.data.accountId===accountId){
    record.current=result.data;confirmed.current=result.data.payload;blocked.current=null;
    localBase.current={version:result.data.version,draftId:result.data.draftId};
    const latest=localPayload.current??patch;
    persist(latest,!accountPrepPayloadsEqual(latest,patch));
    if(editGen.current===(inFlight.current?.editGen??startedEdit))dirty.current=false;
    publish('ok',null);return result;
   }
   const failure:AccountPrepDraftCode=result.ok?'UNAVAILABLE':result.code;
   if(failure==='UNAVAILABLE'||failure==='CONFLICT'){
    try{
     const observed=await readAccountPrepDraft(accountId);if(!ours())return null;
     if(observed.ok&&observed.data&&observed.data.accountId===accountId){
      record.current=observed.data;confirmed.current=observed.data.payload;
      if(accountPrepPayloadsEqual(observed.data.payload,patch)){
       blocked.current=null;localBase.current={version:observed.data.version,draftId:observed.data.draftId};
       const latest=localPayload.current??patch;persist(latest,!accountPrepPayloadsEqual(latest,patch));
       if(editGen.current===(inFlight.current?.editGen??startedEdit))dirty.current=false;
       publish('ok',null);return {ok:true,data:observed.data};
      }
     }
    }catch{/* Keep UNKNOWN; retry later with the same native CAS contract. */}
    if(!ours())return null;blocked.current=failure;
   }
   publish('fail',failure);return {ok:false,code:failure};
  })();
  const flight:InFlight={payload:patch,promise:work.then(async(first)=>{
   if(inFlight.current===flight)inFlight.current=null;
   if(!ours())return first;
   const next=queued.current;queued.current=null;
   if(next&&(!confirmed.current||!accountPrepPayloadsEqual(next,confirmed.current))){
    return writeRunner.current(next);
   }
   return first;
  }),editGen:startedEdit};
  inFlight.current=flight;
  return flight.promise;
 };},[accountId,ours,persist,publish]);

 const save=useCallback(async(patch:AccountPrepDraftPayload):Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>=>{
  if(!ours())return null;
  lastPatch.current=patch;dirty.current=true;syncRequested.current=true;persist(patch,true);
  if(!loaded.current||blocked.current){const code=blocked.current??'UNAVAILABLE';publish('fail',code);return {ok:false,code};}
  if(inFlight.current){
   queued.current=accountPrepPayloadsEqual(patch,inFlight.current.payload)?null:patch;
   if(!queued.current)inFlight.current.editGen=editGen.current;
   return inFlight.current.promise;
  }
  if(confirmed.current&&accountPrepPayloadsEqual(patch,confirmed.current)){
   dirty.current=false;persist(patch,false);publish('ok',null);
   return record.current?{ok:true,data:record.current}:{ok:false,code:'UNAVAILABLE'};
  }
  return writeRunner.current(patch);
 },[ours,persist,publish]);

 const awaitConfirmed=useCallback(async():Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>=>{
  if(!ours())return null;
  if(blocked.current)return {ok:false,code:blocked.current};
  if(inFlight.current)return inFlight.current.promise;
  if(queued.current){
   const queuedResult=await save(queued.current);
   if(queuedResult&&!queuedResult.ok)return queuedResult;
   const remainingFlight:InFlight|null=inFlight.current as InFlight|null;
   if(remainingFlight)return remainingFlight.promise;
  }
  if(confirmed.current&&record.current)return {ok:true,data:record.current};
  return record.current?{ok:true,data:record.current}:{ok:false,code:'UNAVAILABLE'};
 },[ours,save]);

 /** Reconnect without replacing local edits. Conflicts require explicit server reload. */
 const retrySave=useCallback(async():Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>=>{
  if(!ours())return null;
  if(blocked.current==='CONFLICT')return {ok:false,code:'CONFLICT'};
  if(!loaded.current && !await load(false))return {ok:false,code:blocked.current??'UNAVAILABLE'};
  const patch=lastPatch.current;
  if(!patch)return record.current?{ok:true,data:record.current}:null;
  blocked.current=null;return save(patch);
 },[ours,load,save]);
 useEffect(()=>{
  const retry=()=>{if(valid() && (dirty.current || !loaded.current) && !inFlight.current && (!blocked.current || blocked.current==='UNAVAILABLE'))void retrySave();};
  if(typeof window==='undefined'||typeof window.addEventListener!=='function')return;
  window.addEventListener('online',retry);
  window.addEventListener('focus',retry);
  // Each failed attempt publishes a new saved state, scheduling the next retry.
  // Initial read failures also retry; clean/confirmed drafts never poll.
  const timer=saved.scope===scope && saved.status==='fail' && saved.code==='UNAVAILABLE'?window.setTimeout(retry,15000):undefined;
  return()=>{window.removeEventListener('online',retry);window.removeEventListener('focus',retry);if(timer!==undefined)window.clearTimeout(timer);};
 },[retrySave,saved,scope,valid]);

 return {
  hydrated:hydration.scope===scope&&hydration.kind==='ready',
  hydrating:hydration.scope!==scope||hydration.kind==='loading',
  checkpoint,
  localSaved,
  saveStatus:saved.scope===scope?saved.status:'idle' as AccountPrepSaveStatus,
  code:saved.scope===scope?saved.code:null,
  hasUnconfirmedChanges,
  reload,
  retrySave,
  markEdited,
  save,
  awaitConfirmed,
 };
}

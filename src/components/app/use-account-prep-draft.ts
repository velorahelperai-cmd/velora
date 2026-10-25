"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {readAccountPrepDraft,saveAccountPrepDraft} from '@/lib/tenancy/account-prep-draft-actions';
import {
  accountPrepPayloadsEqual,
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
 const writeRunner=useRef<(patch:AccountPrepDraftPayload)=>Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>>(()=>Promise.resolve(null));
 const [hydration,setHydration]=useState({scope,kind:'loading' as 'loading'|'ready'|'error'});
 const [saved,setSaved]=useState({scope,status:'idle' as AccountPrepSaveStatus,code:null as AccountPrepDraftCode|null});
 useLayoutEffect(()=>{callbacks.current={isCurrent,restore};},[isCurrent,restore]);
 useLayoutEffect(()=>{
  live.current=true;liveScope.current=scope;record.current=null;confirmed.current=null;lastPatch.current=null;loaded.current=false;blocked.current=null;
  dirty.current=false;editGen.current=0;inFlight.current=null;queued.current=null;readEpoch.current++;
  return()=>{live.current=false;};
 },[scope]);
 const ours=useCallback(()=>liveScope.current===scope&&callbacks.current.isCurrent(),[scope]);
 const valid=useCallback(()=>live.current&&ours(),[ours]);
 const publish=useCallback((status:AccountPrepSaveStatus,code:AccountPrepDraftCode|null)=>{
  if(live.current&&liveScope.current===scope)setSaved({scope,status,code});
 },[scope]);
 const load=useCallback((explicit:boolean):Promise<boolean>=>{
  if(!valid()||inFlight.current)return Promise.resolve(false);
  const epoch=++readEpoch.current;loaded.current=false;if(explicit){dirty.current=false;editGen.current++;}
  return Promise.resolve().then(()=>readAccountPrepDraft(accountId)).then(result=>{
   if(!ours()||epoch!==readEpoch.current)return false;
   if(!result.ok){if(live.current)setHydration({scope,kind:'error'});publish('fail',result.code);return false;}
   if(result.data&&result.data.accountId!==accountId){if(live.current)setHydration({scope,kind:'error'});publish('fail','UNAVAILABLE');return false;}
   record.current=result.data;loaded.current=true;blocked.current=null;
   confirmed.current=result.data?result.data.payload:null;
   if(result.data&&!dirty.current)callbacks.current.restore(result.data.payload);
   if(live.current)setHydration({scope,kind:'ready'});publish(result.data?'ok':'idle',null);return true;
  }).catch(()=>{if(ours()&&epoch===readEpoch.current){if(live.current)setHydration({scope,kind:'error'});publish('fail','UNAVAILABLE');}return false;});
 },[accountId,ours,publish,scope,valid]);
 useEffect(()=>{void load(false);},[load]);
 const reload=useCallback(()=>{if(!valid()||inFlight.current)return Promise.resolve(false);if(live.current)setHydration({scope,kind:'loading'});return load(true);},[load,scope,valid]);
 const markEdited=useCallback(()=>{if(valid()){dirty.current=true;editGen.current++;}},[valid]);
 const hasUnconfirmedChanges=useCallback(()=>dirty.current||Boolean(inFlight.current)||Boolean(queued.current),[ ]);
 useEffect(()=>{
  if(typeof window==='undefined'||typeof window.addEventListener!=='function')return;
  const warn=(event:BeforeUnloadEvent)=>{if(!hasUnconfirmedChanges())return;event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[hasUnconfirmedChanges]);

 useLayoutEffect(()=>{writeRunner.current=(patch:AccountPrepDraftPayload):Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>=>{
  if(!ours())return Promise.resolve(null);
  if(!loaded.current||blocked.current){const code=blocked.current??'UNAVAILABLE';publish('fail',code);return Promise.resolve({ok:false,code});}
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
       blocked.current=null;if(editGen.current===(inFlight.current?.editGen??startedEdit))dirty.current=false;
       publish('ok',null);return {ok:true,data:observed.data};
      }
     }
    }catch{/* Keep UNKNOWN; manual retry only. */}
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
 };},[accountId,ours,publish]);

 const save=useCallback(async(patch:AccountPrepDraftPayload):Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>=>{
  if(!ours())return null;
  lastPatch.current=patch;
  if(!loaded.current||blocked.current){const code=blocked.current??'UNAVAILABLE';publish('fail',code);return {ok:false,code};}
  if(inFlight.current){
   queued.current=accountPrepPayloadsEqual(patch,inFlight.current.payload)?null:patch;
   if(!queued.current)inFlight.current.editGen=editGen.current;
   return inFlight.current.promise;
  }
  if(confirmed.current&&accountPrepPayloadsEqual(patch,confirmed.current)){
   dirty.current=false;publish('ok',null);
   return record.current?{ok:true,data:record.current}:{ok:false,code:'UNAVAILABLE'};
  }
  return writeRunner.current(patch);
 },[ours,publish]);

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

 /** Manual only. CONFLICT requires reload; other failures retry the last eligible patch once per click. */
 const retrySave=useCallback(():Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>=>{
  if(!ours())return Promise.resolve(null);
  if(blocked.current==='CONFLICT')return reload().then(ok=>ok&&record.current?{ok:true,data:record.current}:{ok:false,code:'CONFLICT'});
  const patch=lastPatch.current;
  if(!patch)return reload().then(ok=>ok&&record.current?{ok:true,data:record.current}:{ok:false,code:'UNAVAILABLE'});
  blocked.current=null;publish('idle',null);return save(patch);
 },[ours,publish,reload,save]);

 return {
  hydrated:hydration.scope===scope&&hydration.kind==='ready',
  hydrating:hydration.scope!==scope||hydration.kind==='loading',
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

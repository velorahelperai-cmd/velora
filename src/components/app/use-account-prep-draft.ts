"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {readAccountPrepDraft,saveAccountPrepDraft} from '@/lib/tenancy/account-prep-draft-actions';
import type {AccountPrepDraftCode,AccountPrepDraftPayload,AccountPrepDraftRecord,AccountPrepDraftResult,AccountPrepSaveStatus} from '@/lib/tenancy/account-prep-draft';

function sameValue(left:unknown,right:unknown):boolean{
 if(Object.is(left,right))return true;
 if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>sameValue(value,right[index]));
 if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
 const a=left as Record<string,unknown>,b=right as Record<string,unknown>,keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&sameValue(a[key],b[key]));
}

/** Shared account draft controller. Readback is not a second write; native CAS stays authoritative. */
export function useAccountPrepDraft({accountId,captureToken='',isCurrent,restore}:{accountId:string;captureToken?:string;isCurrent:()=>boolean;restore:(payload:AccountPrepDraftPayload)=>void}){
 const scope=accountId+':'+captureToken;
 const callbacks=useRef({isCurrent,restore}),live=useRef(false),liveScope=useRef(scope),readEpoch=useRef(0),writeEpoch=useRef(0),writeLock=useRef(false),dirty=useRef(false);
 const record=useRef<AccountPrepDraftRecord|null>(null),loaded=useRef(false),blocked=useRef<AccountPrepDraftCode|null>(null);
 const [hydration,setHydration]=useState({scope,kind:'loading' as 'loading'|'ready'|'error'});
 const [saved,setSaved]=useState({scope,status:'idle' as AccountPrepSaveStatus,code:null as AccountPrepDraftCode|null});
 useLayoutEffect(()=>{callbacks.current={isCurrent,restore};},[isCurrent,restore]);
 useLayoutEffect(()=>{live.current=true;liveScope.current=scope;record.current=null;loaded.current=false;blocked.current=null;dirty.current=false;writeLock.current=false;readEpoch.current++;writeEpoch.current++;return()=>{live.current=false;};},[scope]);
 const valid=useCallback(()=>live.current&&liveScope.current===scope&&callbacks.current.isCurrent(),[scope]);
 const load=useCallback((explicit:boolean):Promise<boolean>=>{
  if(!valid()||writeLock.current)return Promise.resolve(false);
  const epoch=++readEpoch.current;loaded.current=false;if(explicit)dirty.current=false;
  // Promise callbacks are the read subscription; even a synchronous transport throw cannot synchronously update an effect.
  return Promise.resolve().then(()=>readAccountPrepDraft(accountId)).then(result=>{
   if(!valid()||epoch!==readEpoch.current)return false;
   if(!result.ok){setHydration({scope,kind:'error'});setSaved({scope,status:'fail',code:result.code});return false;}
   if(result.data&&result.data.accountId!==accountId){setHydration({scope,kind:'error'});setSaved({scope,status:'fail',code:'UNAVAILABLE'});return false;}
   record.current=result.data;loaded.current=true;blocked.current=null;
   if(result.data&&!dirty.current)callbacks.current.restore(result.data.payload);
   setHydration({scope,kind:'ready'});setSaved({scope,status:result.data?'ok':'idle',code:null});return true;
  }).catch(()=>{if(valid()&&epoch===readEpoch.current){setHydration({scope,kind:'error'});setSaved({scope,status:'fail',code:'UNAVAILABLE'});}return false;});
 },[accountId,scope,valid]);
 useEffect(()=>{void load(false);},[load]);
 const reload=useCallback(()=>{if(!valid()||writeLock.current)return Promise.resolve(false);setHydration({scope,kind:'loading'});return load(true);},[load,scope,valid]);
 const markEdited=useCallback(()=>{if(valid())dirty.current=true;},[valid]);
 const save=useCallback(async(patch:AccountPrepDraftPayload):Promise<AccountPrepDraftResult<AccountPrepDraftRecord>|null>=>{
  if(!valid()||writeLock.current)return null;
  if(!loaded.current||blocked.current){const code=blocked.current??'UNAVAILABLE';setSaved({scope,status:'fail',code});return {ok:false,code};}
  writeLock.current=true;const epoch=++writeEpoch.current;
  const current=()=>valid()&&writeEpoch.current===epoch;
  setSaved({scope,status:'pending',code:null});
  const prior=record.current;
  try{
   let result:AccountPrepDraftResult<AccountPrepDraftRecord>;
   try{result=await saveAccountPrepDraft({expectedAccountId:accountId,expectedVersion:prior?.version??0,patch,...(prior?{draftId:prior.draftId}:{})});}catch{result={ok:false,code:'UNAVAILABLE'};}
   if(!current())return null;
   if(result.ok&&result.data.accountId===accountId){record.current=result.data;blocked.current=null;setSaved({scope,status:'ok',code:null});return result;}
   const failure:AccountPrepDraftCode=result.ok?'UNAVAILABLE':result.code;
   if(failure==='UNAVAILABLE'||failure==='CONFLICT'){
    // A lost response may already have committed. Observe once; never resend automatically.
    try{const observed=await readAccountPrepDraft(accountId);if(!current())return null;
     if(observed.ok&&observed.data&&observed.data.accountId===accountId){
      record.current=observed.data;
      if(Object.keys(patch).every(key=>sameValue(observed.data!.payload[key as keyof AccountPrepDraftPayload],patch[key as keyof AccountPrepDraftPayload]))){blocked.current=null;setSaved({scope,status:'ok',code:null});return {ok:true,data:observed.data};}
     }
    }catch{/* Keep UNKNOWN; a manual reload is required before another write. */}
    if(!current())return null;blocked.current=failure;
   }
   setSaved({scope,status:'fail',code:failure});return {ok:false,code:failure};
  }finally{if(current())writeLock.current=false;}
 },[accountId,scope,valid]);
 return {hydrated:hydration.scope===scope&&hydration.kind==='ready',hydrating:hydration.scope!==scope||hydration.kind==='loading',saveStatus:saved.scope===scope?saved.status:'idle' as AccountPrepSaveStatus,code:saved.scope===scope?saved.code:null,reload,markEdited,save};
}

'use client';
import {useCallback,useEffect,useLayoutEffect,useReducer,useRef,useState} from 'react';
import {useOptionalAccountSession} from './account-chrome';
import {SmartAutosave,type AutosaveAttempt,type AutosaveReceipt,type AutosaveResult} from './smart-autosave';
export function useSmartAccountGuard(userId:string,companyId:string){
 const session=useOptionalAccountSession();
 return useCallback(()=>!session||session.isCurrentUser(userId)&&(!session.identity?.companyId||session.identity.companyId===companyId),[session,userId,companyId]);
}
export function useSmartAutosave<T>(options:{scope:string;value:T;revision:number;digest:string;current?:()=>boolean;validate:(value:unknown)=>value is T;save:(attempt:AutosaveAttempt<T>)=>Promise<AutosaveResult<T>>;committed:(receipt:AutosaveReceipt<T>)=>void}){
 const [,update]=useReducer(n=>n+1,0),latest=useRef(options);
 useLayoutEffect(()=>{latest.current=options;},[options]);
 const [coordinator,setCoordinator]=useState<SmartAutosave<T>|null>(null);
 useLayoutEffect(()=>{let c:SmartAutosave<T>|null=null;const frame=window.requestAnimationFrame(()=>{c=new SmartAutosave({...latest.current,storage:{getItem:k=>window.localStorage.getItem(k),setItem:(k,v)=>window.localStorage.setItem(k,v),removeItem:k=>window.localStorage.removeItem(k)},id:()=>crypto.randomUUID(),current:()=>latest.current.current?.()??true,save:a=>latest.current.save(a),committed:r=>latest.current.committed(r),changed:()=>update()});setCoordinator(c);});return()=>{window.cancelAnimationFrame(frame);c?.dispose();};},[options.scope]);
 const state=coordinator?.key===`velora_smart_settings_v1:${options.scope}`?coordinator.state:undefined;
 const value=state?.value,status=state?.status,revision=state?.revision;
 useEffect(()=>{if(!coordinator||!status||!['changed','offline'].includes(status))return;const timer=window.setTimeout(()=>void coordinator.flush(navigator.onLine),600);return()=>window.clearTimeout(timer);},[coordinator,value,status,revision]);
 // Reconnect is bounded to one dispatch; unknown attempts always require deliberate replay.
 useEffect(()=>{if(!coordinator)return;const online=()=>void coordinator.flush(true);window.addEventListener('online',online);return()=>window.removeEventListener('online',online);},[coordinator]);
 return {state,edit:(value:T)=>coordinator?.edit(value),retry:()=>coordinator?.flush(navigator.onLine,true),reload:(value:T,revision:number,digest:string)=>coordinator?.reload(value,revision,digest)};
}

'use client';
import {useEffect,useRef} from 'react';
import {fetchServiceInbox} from '@/lib/customer/service-inbox-read';
import {CompanyInboxRealtime,type InboxRealtimeEvent} from './branch-inbox-realtime';
import type {DashboardInboxLoad} from './onboarding-contracts';

/** Metadata events invalidate the dashboard; all content comes from the scoped read. */
export function DashboardInboxLive({companyId,actorId,ar,onSnapshot}:{companyId:string;actorId:string;ar:boolean;onSnapshot:(load:DashboardInboxLoad)=>void}) {
 const callback=useRef(onSnapshot);
 const event=useRef<(event:InboxRealtimeEvent)=>void>(()=>{});
 useEffect(()=>{callback.current=onSnapshot;},[onSnapshot]);
 useEffect(()=>{
  let active=true,revoked=false,busy=false,pending=false,live=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deny=()=>{revoked=true;pending=false;clearTimeout(timer);callback.current({ok:false,code:'FORBIDDEN'});};
  async function refresh(){
   if(!active||revoked||document.visibilityState!=='visible')return;
   if(busy){pending=true;return;}
   busy=true;pending=false;
   try {
    const result=await fetchServiceInbox({companyId,actorId});
    if(!active||revoked)return;
    if(!result.ok){
     if(result.code==='SCOPE_CHANGED'||result.code==='FORBIDDEN'||result.code==='NO_COMPANY'){deny();return;}
     callback.current({ok:false,code:'UNAVAILABLE'});return;
    }
    if(result.companyId!==companyId||result.actorId!==actorId){deny();return;}
    callback.current(result.waAllowed===true?result.wa:{ok:false,code:'FORBIDDEN'});
   }catch{if(active&&!revoked)callback.current({ok:false,code:'UNAVAILABLE'});}
   finally{busy=false;if(active&&!revoked&&pending)void refresh();}
  }
  event.current=(message)=>{
   if(!active||revoked)return;
   if(message.type==='revoked'){deny();return;}
   if(message.type==='unavailable'){live=false;return;}
   if(message.type==='ready'||message.type==='reconnect')live=true;
   if(timer===undefined)timer=setTimeout(()=>{timer=undefined;void refresh();},250);
  };
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  const fallback=setInterval(()=>{if(!live)void refresh();},30000);
  document.addEventListener('visibilitychange',visible);
  return()=>{active=false;clearTimeout(timer);clearInterval(fallback);document.removeEventListener('visibilitychange',visible);};
 },[companyId,actorId]);
 return <CompanyInboxRealtime companyId={companyId} actorId={actorId} ar={ar} onInboxEvent={message=>event.current(message)}/>;
}

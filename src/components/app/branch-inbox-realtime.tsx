'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';

export function BranchInboxRealtime({companyId,branchId,channel,ar}:{companyId:string;branchId:string;channel:string;ar:boolean}){
 const router=useRouter();
 const [connected,setConnected]=useState(false);
 useEffect(()=>{
  let active=true,revoked=false,timer:ReturnType<typeof setTimeout>|undefined,retry:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>{if(active&&timer===undefined)timer=setTimeout(()=>{timer=undefined;if(active)router.refresh();},250);};
  const params=new URLSearchParams({company:companyId,branch:branchId,channel});
  let events:EventSource;
  const ready=()=>{if(active){setConnected(true);refresh();}};
  const lost=()=>{if(active){setConnected(false);refresh();}};
  const stopRevoked=()=>{revoked=true;clearTimeout(retry);events.close();lost();};
  const connect=()=>{
   if(!active||revoked)return;
   const current=new EventSource(`/api/branch/inbox-events?${params}`);events=current;
   current.addEventListener('ready',ready);
   current.addEventListener('change',refresh);
   current.addEventListener('revoked',stopRevoked);
   current.addEventListener('unavailable',lost);
   current.onerror=()=>{
    lost();
    // Native EventSource does not retry terminal HTTP errors such as 503.
    if(active&&!revoked&&current.readyState===EventSource.CLOSED&&retry===undefined){
     retry=setTimeout(()=>{retry=undefined;current.close();connect();},5000);
    }
   };
  };
  const visible=()=>{if(document.visibilityState==='visible')refresh();};
  connect();
  document.addEventListener('visibilitychange',visible);
  return()=>{active=false;clearTimeout(timer);clearTimeout(retry);events.close();document.removeEventListener('visibilitychange',visible);};
 },[companyId,branchId,channel,router]);
 return <p role="status" className="text-sm">{connected?(ar?'التحديثات المباشرة متصلة':'Live updates connected'):(ar?'جارٍ الاتصال بالتحديثات المباشرة؛ يمكنك تحديث الصفحة.':'Connecting to live updates; you can refresh the page.')}</p>;
}

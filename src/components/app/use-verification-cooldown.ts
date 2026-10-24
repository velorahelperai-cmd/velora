"use client";
import {useEffect,useRef,useState} from 'react';

// Matches the existing hosted Minimum interval per user, read-only verified at 60s.
// This is advisory browser coordination; Supabase remains the server enforcement.
export const VERIFICATION_RESEND_SECONDS=60;
const eventName='velora-verification-cooldown';
const memory=new Map<string,number>();
async function contextKey(email:string){
  try{const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email));return 'velora.verification.resend.'+[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}catch{return null;}
}
function readDeadline(key:string|null,localKey:string,now=Date.now()){
  let deadline=memory.get(localKey)||0;
  try{if(key){const stored=Number(localStorage.getItem(key));if(Number.isFinite(stored)&&stored>now&&stored<=now+VERIFICATION_RESEND_SECONDS*1000+1000)deadline=Math.max(deadline,stored);}}catch{}
  return deadline>now?deadline:0;
}
function writeDeadline(key:string|null,localKey:string,deadline:number){
  const next=Math.max(readDeadline(key,localKey),deadline);memory.set(localKey,next);
  try{if(key)localStorage.setItem(key,String(next));}catch{}
  if(key)window.dispatchEvent(new CustomEvent(eventName,{detail:{key}}));
  return next;
}
export async function rememberVerificationResend(email:string){
  const normalized=email.trim().toLowerCase();if(!normalized)return;
  const key=await contextKey(normalized);writeDeadline(key,key||normalized,Date.now()+VERIFICATION_RESEND_SECONDS*1000);
}
export function useVerificationCooldown(email:string){
  const normalized=email.trim().toLowerCase();
  const [display,setDisplay]=useState({email:'',seconds:0,ready:false});
  const current=useRef({email:'',key:null as string|null,localKey:'',deadline:0,ready:false});
  useEffect(()=>{
    let alive=true;current.current={email:normalized,key:null,localKey:normalized,deadline:0,ready:false};
    const sync=()=>{const row=current.current;if(!alive||!row.ready||row.email!==normalized)return;row.deadline=Math.max(row.deadline,readDeadline(row.key,row.localKey));setDisplay({email:normalized,ready:true,seconds:Math.max(0,Math.ceil((row.deadline-Date.now())/1000))});};
    void contextKey(normalized).then(key=>{if(!alive)return;current.current={email:normalized,key,localKey:key||normalized,deadline:0,ready:true};sync();});
    const storage=(e:StorageEvent)=>{if(e.key===current.current.key)sync();};
    const shared=(e:Event)=>{if((e as CustomEvent<{key:string}>).detail?.key===current.current.key)sync();};
    const visible=()=>{if(!document.hidden)sync();};
    window.addEventListener('storage',storage);window.addEventListener(eventName,shared);window.addEventListener('focus',sync);document.addEventListener('visibilitychange',visible);
    const timer=window.setInterval(sync,250);
    return()=>{alive=false;window.clearInterval(timer);window.removeEventListener('storage',storage);window.removeEventListener(eventName,shared);window.removeEventListener('focus',sync);document.removeEventListener('visibilitychange',visible);};
  },[normalized]);
  function syncLocal(row:typeof current.current){if(current.current!==row)return;setDisplay({email:row.email,ready:true,seconds:Math.max(0,Math.ceil((row.deadline-Date.now())/1000))});}
  async function reserve(){
    const row=current.current;if(!row.ready||row.email!==normalized)return false;
    const claim=()=>{if(current.current!==row)return false;row.deadline=Math.max(row.deadline,readDeadline(row.key,row.localKey));if(row.deadline>Date.now()){syncLocal(row);return false;}row.deadline=writeDeadline(row.key,row.localKey,Date.now()+VERIFICATION_RESEND_SECONDS*1000);syncLocal(row);return true;};
    // Where supported, serialize simultaneous tab gestures. Provider enforcement is always final.
    if(row.key&&navigator.locks){try{return await navigator.locks.request(row.key,claim);}catch{}}
    return claim();
  }
  function extend(){const row=current.current;if(!row.ready||row.email!==normalized)return;row.deadline=writeDeadline(row.key,row.localKey,Date.now()+VERIFICATION_RESEND_SECONDS*1000);syncLocal(row);}
  return {ready:display.email===normalized&&display.ready,seconds:display.email===normalized?display.seconds:0,reserve,extend};
}

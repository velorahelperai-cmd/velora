"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOptionalAccountSession } from "@/components/app/account-chrome";
import { createClient } from "@/lib/supabase/client";
import { checkSessionActivity } from "./session-actions";
import { emptyBusiness,useDemo } from "@/lib/demo-state";
import { clearPendingSignup } from "./auth-journey";
/** Server timestamps enforce the policy. This timer provides UI updates only. */
export function SessionActivityTracker(){
 const {update,locale}=useDemo();
 const session=useOptionalAccountSession(),router=useRouter(),pathname=usePathname(),pathRef=useRef(pathname);
 useEffect(()=>{pathRef.current=pathname;},[pathname]);
 const lastTouch=useRef(0),expiryHandled=useRef(false);
 useEffect(()=>{
  if(session?.status==="expired"){
    if(expiryHandled.current)return;
    expiryHandled.current=true;
    clearPendingSignup();update({account:null,signedIn:false,stage:"guest",business:emptyBusiness,businessSaved:false,setupStep:0,setupDone:[false,false,false,false]});
    const path=pathRef.current;
    void createClient().auth.signOut({scope:"local"}).catch(()=>{}).finally(()=>{session.clear();if(/^\/(app|admin|account|setup|complete-profile)(\/|$)/.test(path))router.replace(`/login?reason=session_expired&next=${encodeURIComponent(path+window.location.search)}`);router.refresh();});
    return;
  }
  if(session?.status!=="ready"||!session.identity)return;
  expiryHandled.current=false;
  let stopped=false,busy=false,timer:ReturnType<typeof setTimeout>|undefined;
  let expiry=Date.parse(session.identity.sessionExpiresAt??"");
  const schedule=()=>{if(timer)clearTimeout(timer);if(Number.isFinite(expiry))timer=setTimeout(()=>{void check(false);},Math.min(Math.max(expiry-Date.now()+100,1000),3600000));};
  async function check(touch:boolean){
    if(stopped||busy)return;busy=true;
    try{
      const result=await checkSessionActivity(touch);
      if(stopped)return;
      if(result.ok){expiry=Date.parse(result.expiresAt);schedule();return;}
      if(result.code==="UNAUTHENTICATED"){stopped=true;session?.expire();return;}
      timer=setTimeout(()=>{void check(false);},30000);
    }finally{busy=false;}
  }
  function activity(event:Event){
    if(!event.isTrusted||document.visibilityState!=="visible"||stopped)return;
    if(Date.now()-lastTouch.current<30000)return;
    lastTouch.current=Date.now();void check(true);
  }
  const events=["pointerdown","keydown","scroll","focus","visibilitychange"] as const;
  events.forEach(event=>window.addEventListener(event,activity,{passive:true}));
  schedule();if(!Number.isFinite(expiry))void check(false);
  return ()=>{stopped=true;if(timer)clearTimeout(timer);events.forEach(event=>window.removeEventListener(event,activity));};
 },[session,router,update]);
 return session?.status==="expired"?<div role="alert" className="fixed inset-0 z-[1000] grid place-items-center bg-[#07110d] px-6 text-center text-white"><p>{locale==="ar"?"انتهت الجلسة. جارٍ تأمين الحساب والعودة لتسجيل الدخول…":"Your session expired. Securing your account and returning to sign in…"}</p></div>:null;
}




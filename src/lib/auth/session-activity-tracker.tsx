"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOptionalAccountSession } from "@/components/app/account-chrome";
import { tryCreateClient } from "@/lib/supabase/client";
import { checkSessionActivity } from "./session-actions";
import { emptyBusiness,useDemo } from "@/lib/demo-state";
import { clearPendingSignup } from "./auth-journey";
import { recordSessionCheckUnavailable } from "@/lib/logging/browser.mjs";
/** Server timestamps enforce the policy. This timer provides UI updates only. */
export function SessionActivityTracker(){
 const {update,locale}=useDemo();
 const session=useOptionalAccountSession(),router=useRouter(),pathname=usePathname(),pathRef=useRef(pathname);
 useEffect(()=>{pathRef.current=pathname;},[pathname]);
 const lastTouch=useRef({userId:"",at:0}),expiryHandled=useRef(false);
 useEffect(()=>{
  if(session?.status==="expired"){
    if(session.hasCurrentUser())return;
    if(expiryHandled.current)return;
    expiryHandled.current=true;
    let cancelled=false;
    clearPendingSignup();update({account:null,signedIn:false,stage:"guest",business:emptyBusiness,businessSaved:false,setupStep:0,setupDone:[false,false,false,false]});
    const path=pathRef.current;
    const signedOut=tryCreateClient()?.auth.signOut({scope:"local"})??Promise.resolve();
    void signedOut.catch(()=>{}).finally(()=>{if(cancelled||session.hasCurrentUser())return;session.clear();if(/^\/(app|admin|account|setup|complete-profile)(\/|$)/.test(path))router.replace(`/login?reason=session_expired&next=${encodeURIComponent(path+window.location.search)}`);router.refresh();});
    return ()=>{cancelled=true;};
  }
  if(session?.status!=="ready"||!session.identity)return;
  expiryHandled.current=false;
  const identity=session.identity,userId=identity.userId;
  let stopped=false,busy=false,pendingTouch=false,outageLogged=false,timer:ReturnType<typeof setTimeout>|undefined;
  const current=()=>!stopped&&session.isCurrentUser(userId,identity);
  let expiry=Date.parse(session.identity.sessionExpiresAt??"");
  const schedule=()=>{if(timer)clearTimeout(timer);if(Number.isFinite(expiry))timer=setTimeout(()=>{void check(false);},Math.min(Math.max(expiry-Date.now()+100,1000),3600000));};
  const retry=()=>{if(!outageLogged){recordSessionCheckUnavailable(identity);outageLogged=true;}if(timer)clearTimeout(timer);timer=setTimeout(()=>{void check(false);},30000);};
  async function check(touch:boolean){
    if(!current())return;if(busy){if(touch)pendingTouch=true;return;}busy=true;
    try{
      const result=await checkSessionActivity(touch);
      if(!current())return;
      if(result.ok){outageLogged=false;expiry=Date.parse(result.expiresAt);schedule();return;}
      if(result.code==="UNAUTHENTICATED"){stopped=true;session?.expire();return;}
      retry();
    }catch{
      // A failed Server Action transport is not proof of expiry. Retry only a
      // read; reconnecting cannot invent human activity or revive a session.
      if(current())retry();
    }finally{busy=false;if(pendingTouch&&current()){pendingTouch=false;void check(true);}}
  }
  function activity(event:Event){
    if(!event.isTrusted||document.visibilityState!=="visible"||!current())return;
    if(lastTouch.current.userId===userId&&Date.now()-lastTouch.current.at<30000)return;
    lastTouch.current={userId,at:Date.now()};void check(true);
  }
  const recheck=()=>{if(document.visibilityState==="visible")void check(false);};
  window.addEventListener("focus",recheck);window.addEventListener("visibilitychange",recheck);
  const events=["pointerdown","keydown","wheel","touchmove"] as const;
  events.forEach(event=>window.addEventListener(event,activity,{passive:true}));
  schedule();if(!Number.isFinite(expiry))void check(false);
  return ()=>{stopped=true;if(timer)clearTimeout(timer);window.removeEventListener("focus",recheck);window.removeEventListener("visibilitychange",recheck);events.forEach(event=>window.removeEventListener(event,activity));};
 },[session,router,update]);
 return session?.status==="expired"?<div role="alert" className="fixed inset-0 z-[1000] grid place-items-center bg-[#07110d] px-6 text-center text-white"><p>{locale==="ar"?"انتهت الجلسة. جارٍ تأمين الحساب والعودة لتسجيل الدخول…":"Your session expired. Securing your account and returning to sign in…"}</p></div>:null;
}




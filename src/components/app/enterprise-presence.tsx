"use client";
import { useEffect } from "react";
import { heartbeatEnterprisePresence } from "@/lib/enterprise/actions";
/** Presence is session-authenticated, clocked by SQL, and separate from activity.
 * Background polling never calls check_app_session(touch=true). */
export function EnterprisePresence({userId,companyId}:{userId:string;companyId:string}) {
 useEffect(()=>{
  let active=true,pending=false;
  const beat=async()=>{if(!active||pending||document.visibilityState!=="visible")return;pending=true;try{const result=await heartbeatEnterprisePresence(userId,companyId);if(!result.ok&&["FORBIDDEN","UNAUTHENTICATED","NOT_INSTALLED"].includes(result.code))active=false;}finally{pending=false;}};
  const wake=()=>{void beat();};wake();
  const timer=setInterval(wake,30000);document.addEventListener("visibilitychange",wake);
  return ()=>{active=false;clearInterval(timer);document.removeEventListener("visibilitychange",wake);};
 },[userId,companyId]);
 return null;
}

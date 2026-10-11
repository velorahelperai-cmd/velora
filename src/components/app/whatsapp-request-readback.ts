"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {getWhatsappCompanyLink} from "@/lib/whatsapp/connection-actions";
import type {WhatsappCompanyLink} from "@/lib/whatsapp/connection";
export type WhatsappRequestReadStatus="loading"|"ready"|"failed";
type Scope={userId:string;companyId:string|null};
type Request={scope:Scope;active:boolean;pending:boolean;version:number};
type Snapshot={scope:Scope;status:WhatsappRequestReadStatus;link:WhatsappCompanyLink|null};
/** Reads only client-safe, authenticated selected-company request facts. */
export function useWhatsappRequestReadback(userId:string,companyId:string|null,revision:string|undefined){
 const scope=useMemo(()=>({userId,companyId}),[userId,companyId]);
 const request=useRef<Request|null>(null);
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const read=useCallback(async(current:Request)=>{
  if(!current.active||current.pending||!current.scope.companyId)return;
  current.pending=true;const version=++current.version;
  setSnapshot(previous=>({scope:current.scope,status:"loading",link:previous?.scope===current.scope?previous.link:null}));
  try{
   const result=await getWhatsappCompanyLink();
   if(!current.active||version!==current.version)return;
   if(result.ok&&result.data.companyId===current.scope.companyId){
    setSnapshot({scope:current.scope,status:"ready",link:result.data});
   }else{
    const hide=!result.ok&&["UNAUTHENTICATED","FORBIDDEN","COMPANY_SUSPENDED"].includes(result.code);
    setSnapshot(previous=>({scope:current.scope,status:"failed",link:!hide&&previous?.scope===current.scope?previous.link:null}));
   }
  }catch{
   if(current.active&&version===current.version)setSnapshot(previous=>({scope:current.scope,status:"failed",link:previous?.scope===current.scope?previous.link:null}));
  }finally{if(current.active&&version===current.version)current.pending=false;}
 },[]);
 useEffect(()=>{
  const current:Request={scope,active:true,pending:false,version:0};request.current=current;
  const frame=window.requestAnimationFrame(()=>void read(current));
  return()=>{current.active=false;window.cancelAnimationFrame(frame);};
 },[scope,revision,read]);
 const refresh=()=>{const current=request.current;if(current?.scope===scope)void read(current);};
 const adopt=(link:WhatsappCompanyLink)=>{
  const current=request.current;
  if(!current?.active||current.scope!==scope||link.companyId!==companyId)return;
  ++current.version;current.pending=false;
  setSnapshot({scope,status:"ready",link});
 };
 const current=snapshot?.scope===scope?snapshot:null;
 return {link:current?.link??null,status:current?.status??"loading",refresh,adopt};
}

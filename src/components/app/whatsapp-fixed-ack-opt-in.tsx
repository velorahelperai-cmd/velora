"use client";
import {useEffect,useState} from "react";
import {getFixedAckSetup,configureFixedAck} from "@/lib/whatsapp/embedded-signup-actions";
import {Button,Notice} from "./ui";
export function WhatsappFixedAckOptIn({companyId}:{companyId:string}){
 const [available,setAvailable]=useState(false),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 useEffect(()=>{let current=true;void getFixedAckSetup(companyId).then(r=>{if(!current)return;if(r.ok&&r.available){setAvailable(true);setEnabled(r.enabled);}else if(!r.ok)setFailed(true);}).catch(()=>{if(current)setFailed(true);});return()=>{current=false;};},[companyId]);
 async function toggle(){setBusy(true);setFailed(false);try{const r=await configureFixedAck(companyId,!enabled);if(r.ok)setEnabled(r.enabled);else setFailed(true);}catch{setFailed(true);}finally{setBusy(false);}}
 if(!available&&!failed)return null;
 return <div className="grid gap-2 rounded-xl border border-[color:var(--color-border-soft)] p-4">
 <p className="font-medium">Fixed acknowledgement</p>
 <p className="text-sm text-[var(--color-muted-soft)]">Replies only to the approved controlled recipient. Resume automation in the conversation first. Your verified owner session must remain active. This sends a fixed acknowledgement and does not use AI.</p>
 {failed&&<Notice tone="warn">Acknowledgement settings could not be verified. Try again with an active owner session.</Notice>}
 {available&&<><p role="status">{enabled?"Company opt-in enabled":"Company opt-in disabled"}</p><Button disabled={busy} onClick={()=>void toggle()}>{enabled?"Disable acknowledgement":"Enable acknowledgement"}</Button></>}
 </div>;
}

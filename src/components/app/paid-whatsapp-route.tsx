"use client";

import {useEffect, useRef, useState} from "react";
import {useDemo} from "@/lib/demo-state";
import {useOptionalAccountSession,AccountMenu} from "./account-chrome";
import {LangSwitch} from "./ui";
import {PaidChannelView} from "./paid-channel-view";
import {scopedChannelConnection} from "./paid-channel-connection-model";
import {setupBranchPath} from "@/lib/auth/setup-return";
import type {PaidBranchSetupRead} from "@/lib/tenancy/paid-setup-contracts";
import type {PaidBranchConnectionRead} from "@/lib/tenancy/paid-branch-connection-contracts";
import styles from "./paid-assistant-checklist.module.css";

export type PaidWhatsappRouteProps={
  scope:{expectedAccountId:string;companyId:string;branchId:string};
  read:PaidBranchSetupRead;
  connectionRead:PaidBranchConnectionRead;
  /** Server-bracketed B3 generation around the B1 projection, never a URL input. */
  confirmedGeneration:number|null;
};
export function confirmedWhatsappReturn(props:PaidWhatsappRouteProps):boolean {
  const {read,scope,confirmedGeneration}=props;
  const connection=scopedChannelConnection(props.connectionRead,{...scope,channel:"whatsapp"});
  const steps=read.steps.filter(step=>step.id==="connect_whatsapp");
  return read.sourceStatus==="ready"&&read.companyId===scope.companyId&&read.selectedBranchId===scope.branchId&&
    !!read.entitlement&&read.branches.some(branch=>branch.id===scope.branchId)&&!!read.selectedChannels?.includes("whatsapp")&&
    steps.length===1&&steps[0]!.status==="verified"&&steps[0]!.reasonCodes.length===0&&
    !!connection&&connection.connection.state==="connected"&&connection.connection.verified&&
    connection.connection.reasonCodes.length===0&&typeof confirmedGeneration==="number"&&Number.isSafeInteger(confirmedGeneration)&&confirmedGeneration>=1&&
    connection.connection.link?.generation===confirmedGeneration;
}
export function PaidWhatsappRoute(props:PaidWhatsappRouteProps) {
  const session=useOptionalAccountSession();
  const {locale}=useDemo();
  const [capture]=useState(session?.boundaryFingerprint);
  const returned=useRef(false);
  const live=session?.liveSnapshot();
  const current=session?.status==="ready"&&!!capture&&capture===session.boundaryFingerprint&&
    session.identity?.userId===props.scope.expectedAccountId&&session.identity.companyId===props.scope.companyId&&
    live?.ready&&live.userId===props.scope.expectedAccountId&&live.boundaryFingerprint===capture&&
    session.isCurrentUser(props.scope.expectedAccountId,session.identity);
  const confirmed=confirmedWhatsappReturn(props);
  useEffect(()=>{
    // Recheck the live boundary immediately before navigating, including updates
    // that happened after render. Never trust a provider callback or guide slide.
    const now=session?.liveSnapshot();
    if(!current||!confirmed||returned.current||!now?.ready||now.userId!==props.scope.expectedAccountId||
      now.boundaryFingerprint!==capture||!session?.identity||!session.isCurrentUser(props.scope.expectedAccountId,session.identity))return;
    returned.current=true;
    window.location.replace(setupBranchPath(props.scope.branchId));
  },[current,confirmed,session,capture,props.scope.expectedAccountId,props.scope.branchId]);
  useEffect(()=>{
    const restore=(event:PageTransitionEvent)=>{if(event.persisted)window.location.reload();};
    window.addEventListener("pageshow",restore);
    return ()=>window.removeEventListener("pageshow",restore);
  },[]);
  const ar=locale==="ar";
  return <main className={styles.surface} dir={ar?"rtl":"ltr"}>
    <header className={styles.page}><LangSwitch/><AccountMenu compact/>
      <h1>{ar?"ربط واتساب":"Connect WhatsApp"}</h1>
      <a href={setupBranchPath(props.scope.branchId)} style={{display:"inline-flex",alignItems:"center",minHeight:44,color:"#007f98"}}>{ar?"العودة إلى تجهيز مساعدك":"Back to assistant setup"}</a>
    </header>
    {current?<><PaidChannelView locale={locale} scope={{...props.scope,boundaryFingerprint:capture}} read={props.read} connectionRead={props.connectionRead} channel="whatsapp"/>
      <section className={styles.page}><button type="button" onClick={()=>window.location.reload()}>{ar?"تحديث حالة الربط":"Refresh connection status"}</button></section></>:
      <section className={styles.page} role="status">{ar?"تغيّرت جلسة العمل. ارجع إلى الإعداد للتحقق من الفرع.":"Your workspace session changed. Return to setup to verify the branch."}</section>}
  </main>;
}

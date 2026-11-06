"use client";
import Link from "next/link";
import paidStyles from './paid-assistant-checklist.module.css';
import studioStyles from './setup-studio.module.css';
import {SetupStudioLangSwitch} from './setup-studio-lang-switch';
import { useCallback, useLayoutEffect, useRef } from "react";
import { useDemo } from "@/lib/demo-state";
import { AccountMenu, useOptionalAccountSession } from "@/components/app/account-chrome";
import { PaidAssistantChecklist, PaidSetupFlow } from "./paid-assistant-checklist";
import {readOwnedPaidBranchSetupAction} from "@/lib/tenancy/paid-setup-actions";
import {readSetupEntry} from "@/lib/tenancy/setup-read-client";

/** The paid entry needs identifiers, not a serialized company record.
 * Accounts without a company remain on PrepaymentPreparation. */
export function PaidSetupWizard(props:{userId:string;companyId:string}) {
 const session=useOptionalAccountSession();
 const {locale}=useDemo();
 const companyId=props.companyId;
 const identity=session?.identity;
 const boundaryFingerprint=session?.boundaryFingerprint;
 const sessionRef=useRef(session);
 const identityRef=useRef(identity);
 const boundaryRef=useRef(boundaryFingerprint);
 useLayoutEffect(()=>{sessionRef.current=session;identityRef.current=identity;boundaryRef.current=boundaryFingerprint;},[session,identity,boundaryFingerprint]);
 // Stable authority check: object identity churn must not remount the branch reader or wipe caches.
 const isCurrent=useCallback(()=>{
  const liveSession=sessionRef.current,liveIdentity=identityRef.current,liveBoundary=boundaryRef.current;
  if(!liveSession||!liveIdentity||!liveBoundary||liveIdentity.companyId!==companyId)return false;
  const live=liveSession.liveSnapshot();
  return live.ready&&live.userId===props.userId&&live.boundaryFingerprint===liveBoundary&&liveSession.isCurrentUser(props.userId,liveIdentity);
 },[companyId,props.userId]);
 const readEntry=useCallback((input:{expectedAccountId:string;companyId:string})=>readSetupEntry(
  {...input,boundaryFingerprint:boundaryFingerprint??''},
  ()=>isCurrent()&&boundaryRef.current===boundaryFingerprint,
 ),[isCurrent,boundaryFingerprint]);
 if(session?.status!=="ready"||!boundaryFingerprint||identity?.userId!==props.userId||identity.companyId!==companyId)return <PaidAssistantChecklist locale={locale} model={null} loading={session?.status==="loading"}/>;
 return <main className={paidStyles.paidShell} dir={locale==='ar'?'rtl':'ltr'} data-service-theme="">
  <PaidSetupFlow locale={locale} scope={{expectedAccountId:props.userId,companyId,boundaryFingerprint}} isCurrent={isCurrent} readEntry={readEntry} readBranch={readOwnedPaidBranchSetupAction} renderHeader={(branchSelector,title,planSummary)=><header className={`${studioStyles.header} ${paidStyles.paidHeader} ${paidStyles.titleHeader}`}>{title&&<h1 className={paidStyles.headerTitle}>{title}</h1>}<div className={paidStyles.headerBrand}><Link href="/" className={studioStyles.brand}>Velora</Link>{branchSelector}{planSummary}</div><div className={studioStyles.headerTools}><SetupStudioLangSwitch/><div className={studioStyles.accountControl}><AccountMenu compact/></div></div></header>}/>
 </main>;
}

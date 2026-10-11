"use client";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState} from "react";
import {useDemo} from "@/lib/demo-state";
import {readPlatformTeamSelf} from "@/lib/platform-teams/actions";
import type {TeamResult,TeamSelf} from "@/lib/platform-teams/contracts";
import {useOptionalAccountSession} from "@/components/app/account-chrome";
import {Button,Card,Notice} from "@/components/app/ui";
import {teamCopy,type TeamCopy} from "./copy";

export function TeamSelfSummary({value,copy:c}:{value:TeamSelf;copy:TeamCopy}){
 if(!value.memberships.length)return <p>{c.selfEmpty}</p>;
 return <ul className="grid gap-3">{value.memberships.map(entry=><li key={entry.membership.teamId} className="rounded-xl border border-[color:var(--color-border-soft)] p-3">
  <p className="font-semibold">{entry.access==="active"?entry.team!.name:c.denied}</p>
  <dl className="mt-2 grid gap-1 text-sm">
   <div><dt className="inline">{c.role}: </dt><dd className="inline">{entry.membership.role==="manager"?c.manager:c.employee}</dd></div>
   <div><dt className="inline">{c.status}: </dt><dd className="inline">{entry.membership.status==="active"?c.active:c.disabled}</dd></div>
   {entry.membership.specialty?<div><dt className="inline">{c.specialty}: </dt><dd className="inline">{entry.membership.specialty}</dd></div>:null}
   {entry.access==="active"&&entry.manager?<div><dt className="inline">{c.manager}: </dt><dd className="inline">{entry.manager.fullName||c.unavailableName}</dd></div>:null}
  </dl>
  {entry.access==="active"&&entry.membership.role==="manager"?<Link className="mt-3 inline-flex min-h-11 items-center underline" href={`/account/teams?team=${encodeURIComponent(entry.membership.teamId)}`}>{c.view}</Link>:null}
 </li>)}</ul>;
}

export function TeamSelfPanel({actorId}:{actorId:string}){
 const {locale}=useDemo(),c=teamCopy(locale),session=useOptionalAccountSession();
 const ready=session?.status==="ready"&&session.identity?.userId===actorId;
 const [phase,setPhase]=useState({ready,epoch:0});
 if(phase.ready!==ready)setPhase({ready,epoch:phase.epoch+1});
 const contextKey=[actorId,session?.identity?.platformIdentity.role,session?.identity?.platformIdentity.status,session?.identity?.platformIdentity.unavailable,phase.epoch].join(":");
 const [stored,setStored]=useState<{key:string;value:TeamResult<TeamSelf>}|null>(null);
 const result=stored?.key===contextKey?stored.value:null;
 const generation=useRef(0),mounted=useRef(false);
 const current=useCallback(()=>mounted.current&&session?.status==="ready"&&session.isCurrentUser(actorId),[actorId,session]);
 const refresh=useCallback(async()=>{
  const gen=++generation.current;if(!current())return;setStored(null);
  let next:TeamResult<TeamSelf>;try{next=await readPlatformTeamSelf(actorId);}catch{next={ok:false,code:"UNAVAILABLE"};}
  if(current()&&gen===generation.current)setStored({key:contextKey,value:next});
 },[actorId,current,contextKey]);
 useEffect(()=>{
  mounted.current=true;
  const frame=ready?window.requestAnimationFrame(()=>void refresh()):null;
  const counter=generation;
  const recheck=()=>{if(document.visibilityState==="visible")void refresh();};
  window.addEventListener("focus",recheck);document.addEventListener("visibilitychange",recheck);
  return()=>{mounted.current=false;counter.current++;if(frame!==null)window.cancelAnimationFrame(frame);window.removeEventListener("focus",recheck);document.removeEventListener("visibilitychange",recheck);};
 },[ready,refresh,session?.identity?.platformIdentity.role,session?.identity?.platformIdentity.status]);
 if(!ready)return null;
 const owner=session?.identity?.platformIdentity;
 return <Card title={c.selfTitle} className="mt-6" aside={<Button type="button" variant="ghost" onClick={()=>void refresh()}>{c.refresh}</Button>}>
  {result===null?<p role="status" aria-busy="true">{c.loading}</p>:result.ok?<TeamSelfSummary value={result.data} copy={c}/>:<Notice tone="error">{c.errors[result.code]}</Notice>}
  {owner?.role==="owner"&&owner.status==="active"&&!owner.unavailable?<Link className="mt-3 inline-flex min-h-11 items-center underline" href="/admin/teams">{c.ownerTeams}</Link>:null}
 </Card>;
}

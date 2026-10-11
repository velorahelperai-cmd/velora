"use client";
import Link from "next/link";
import {useRouter,useSearchParams} from "next/navigation";
import {useEffect,useLayoutEffect,useState,useSyncExternalStore} from "react";
import {useDemo} from "@/lib/demo-state";
import {readPlatformTeamDirectory,previewPlatformTeamTransfer,mutatePlatformTeam} from "@/lib/platform-teams/actions";
import type {TeamDirectory,TeamFailure,TeamMember} from "@/lib/platform-teams/contracts";
import {createTeamUiStore,type TeamScope} from "@/lib/platform-teams/ui-state";
import {teamHref,teamQuery} from "@/lib/platform-teams/ui-routing";
import {AppTopBar,useOptionalAccountSession} from "@/components/app/account-chrome";
import {Button,Card,Field,Notice} from "@/components/app/ui";
import {teamCopy,type TeamCopy} from "./copy";
import {TeamOwnerEditor} from "./team-owner-editor";

const api={readDirectory:readPlatformTeamDirectory,preview:previewPlatformTeamTransfer,mutate:mutatePlatformTeam};
export function TeamsFailure({code,embedded=false}:{code:TeamFailure["code"];embedded?:boolean}){
 const {locale}=useDemo(),c=teamCopy(locale),router=useRouter();
 const Container=embedded?"div":"main";
 return <Container className="app-shell px-4 py-8"><div className="mx-auto grid max-w-xl gap-4"><Notice tone="error">{c.errors[code]}</Notice><div className="flex flex-wrap gap-2"><Button onClick={()=>router.refresh()}>{c.refresh}</Button><Link className="inline-flex min-h-11 items-center underline" href="/account">{c.account}</Link>{code==="UNAUTHENTICATED"?<Link href="/login">{c.verification}</Link>:null}{code==="UNVERIFIED"?<Link href="/verify-email">{c.emailVerification}</Link>:null}</div></div></Container>;
}

export function TeamDirectoryRows({directory,copy:c,editor,onTeam,onMember}:{directory:TeamDirectory;copy:TeamCopy;editor:boolean;onTeam:(id:string)=>void;onMember:(member:TeamMember,transfer:boolean)=>void}){
 if(!directory.rows.length)return <p>{c.empty}</p>;
 return <ul className="grid gap-3">{directory.rows.map(row=>"id"in row?<li key={row.id} className="rounded-xl border border-[color:var(--color-border-soft)] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{row.name}</p><p className="text-sm">{row.status==="active"?c.active:c.disabled} · {c.members}: {row.memberCount}</p></div><Button variant="secondary" onClick={()=>onTeam(row.id)}>{c.view}</Button></div></li>:<li key={row.userId} className="rounded-xl border border-[color:var(--color-border-soft)] p-4"><p className="font-semibold">{row.fullName||c.unavailableName}</p><p className="text-sm">{row.role==="manager"?c.manager:c.employee} · {row.status==="active"?c.active:c.disabled}{row.specialty?` · ${row.specialty}`:""}</p>{editor?<div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={()=>onMember(row,false)}>{c.editMember}</Button><Button variant="secondary" disabled={row.status!=="active"||directory.team?.status==="active"&&directory.team.managerUserId===row.userId} title={directory.team?.status==="active"&&directory.team.managerUserId===row.userId?c.replaceManager:undefined} onClick={()=>onMember(row,true)}>{c.transfer}</Button></div>:null}</li>)}</ul>;
}

export function TeamsPage({actorId,editor}:{actorId:string;editor:boolean}){
 const {locale}=useDemo(),c=teamCopy(locale),session=useOptionalAccountSession(),router=useRouter(),params=useSearchParams();
 const [store]=useState(()=>createTeamUiStore({actorId,api,storage:()=>window.sessionStorage,isCurrentActor:()=>false,canWrite:()=>false}));

 const state=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 const path=editor?"/admin/teams":"/account/teams";
 const Container=editor?"div":"main";
 const query=params.toString(),urlScope=teamQuery(actorId,new URLSearchParams(query));
 const appliedSearch=urlScope.ok?urlScope.data.search:"";
 const [search,setSearch]=useState(appliedSearch);
 const [selection,setSelection]=useState<{member:TeamMember;transfer:boolean}|null>(null);
 const ready=session?.status==="ready"&&session.identity?.userId===actorId;
 const owner=editor&&session?.identity?.platformIdentity.role==="owner"&&session.identity.platformIdentity.status==="active"&&!session.identity.platformIdentity.unavailable;
 const viewKey=JSON.stringify([actorId,ready,query,session?.identity?.platformIdentity.role,session?.identity?.platformIdentity.status,session?.identity?.platformIdentity.unavailable]);
 useLayoutEffect(()=>{
  store.bindAuthority(()=>session?.status==="ready"&&session.isCurrentUser(actorId)||false,()=>editor&&session?.status==="ready"&&session.isCurrentUser(actorId)&&session.identity?.platformIdentity.role==="owner"&&session.identity.platformIdentity.status==="active"&&!session.identity.platformIdentity.unavailable,viewKey);
 },[store,session,actorId,editor,viewKey]);
 useEffect(()=>{
  if(!ready||editor&&!owner){store.suspend();return;}
  store.activate();
  const scope=teamQuery(actorId,new URLSearchParams(query));if(scope.ok)void store.load(scope.data);
  return()=>store.suspend();
 },[ready,owner,editor,actorId,query,store,session?.identity?.platformIdentity.role,session?.identity?.platformIdentity.status]);
 useEffect(()=>{const recheck=()=>{if(document.visibilityState==="visible"&&store.isCurrent())void store.load({...store.getSnapshot().scope,cursor:null});};window.addEventListener("focus",recheck);document.addEventListener("visibilitychange",recheck);return()=>{window.removeEventListener("focus",recheck);document.removeEventListener("visibilitychange",recheck);};},[store]);
 const [trackedSearch,setTrackedSearch]=useState(appliedSearch);
 if(trackedSearch!==appliedSearch){setTrackedSearch(appliedSearch);setSearch(appliedSearch);}
 function navigate(scope:TeamScope){store.invalidateReview();setSelection(null);setSearch(scope.search);void store.load(scope);router.push(teamHref(path,scope));}
 if(!ready||state.contextKey!==viewKey)return <Container className="app-shell p-6"><Notice>{c.loading}</Notice></Container>;
 if(editor&&!owner)return <TeamsFailure embedded={editor} code={session?.identity?.platformIdentity.unavailable?"UNAVAILABLE":"FORBIDDEN"}/>;
 if(!urlScope.ok)return <TeamsFailure embedded={editor} code={urlScope.code}/>;
 const directory=state.directory?.ok?state.directory.data:null;
 const writeReady=owner&&directory!==null&&!state.loading&&!state.writing&&!state.uncertain;
 return <Container data-internal-ui="true" className="app-shell px-4 py-6"><div className="mx-auto grid min-w-0 max-w-5xl gap-5 [overflow-wrap:anywhere]">
  {!editor?<AppTopBar/>:null}
  <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">{editor?c.title:c.rosters}</h1><Link className="inline-flex min-h-11 items-center underline" href="/account">{c.account}</Link></div>
  <dl className="grid gap-2 text-sm"><div><dt className="inline">{c.platformRole}: </dt><dd className="inline">{session.identity?.platformIdentity.unavailable?c.unavailableName:session.identity?.platformIdentity.role==="owner"?c.platformOwner:session.identity?.platformIdentity.role==="delegated"?c.platformDelegated:c.platformAccount}</dd></div><div><dt className="inline">{c.scopeAccess}: </dt><dd className="inline">{directory?.team?.name??(directory?(editor?c.all:c.rosters):c.loading)}</dd></div></dl>
  {!editor?<p className="text-sm">{c.readOnlyHint}</p>:null}
  {state.confirmed?<Notice tone="success">{c.saved}{state.directory&&!state.directory.ok?` ${c.refreshAfterSave}`:""}</Notice>:null}
  {state.writing?<p role="status" aria-busy="true">{c.saving}</p>:null}
  {state.uncertain?<Notice tone="warn">{c.uncertain} <Button busy={state.writing} busyLabel={c.saving} disabled={!owner} onClick={()=>void store.retry()}>{c.retry}</Button></Notice>:null}
  {state.error?<Notice tone="error">{state.error==="RETRY_STORAGE"?c.safeRetry:c.errors[state.error]}</Notice>:null}
  <Card title={directory?.team?.name}>
   <form onSubmit={event=>{event.preventDefault();navigate({teamId:state.scope.teamId,search,cursor:null});}} className="mb-4 flex flex-wrap items-end gap-3">
    <div className="min-w-[12rem] flex-1"><Field label={c.search}>{p=><input {...p} maxLength={120} value={search} onChange={e=>setSearch(e.target.value)}/>}</Field></div>
    <Button type="submit" disabled={state.writing}>{c.apply}</Button><Button type="button" variant="secondary" disabled={state.writing} onClick={()=>navigate({teamId:null,search:"",cursor:null})}>{c.reset}</Button>
    <Button type="button" variant="ghost" busy={state.loading} disabled={state.writing} onClick={()=>void store.load({...state.scope,cursor:null})}>{c.refresh}</Button>
   </form>
   {state.scope.teamId?<Button variant="ghost" disabled={state.writing} onClick={()=>navigate({teamId:null,search:"",cursor:null})}>{c.all}</Button>:null}
   {state.loading||state.directory===null&&!state.error&&!state.writing?<p role="status" aria-busy="true">{c.loading}</p>:directory?<>
    <p className="mb-3 text-sm">{c.total}: {directory.total}</p>
    <TeamDirectoryRows directory={directory} copy={c} editor={writeReady} onTeam={id=>navigate({teamId:id,search:"",cursor:null})} onMember={(member,transfer)=>{store.invalidateReview();setSelection({member,transfer});}}/>
    <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" disabled={!state.scope.cursor||state.writing} onClick={()=>navigate({...state.scope,cursor:null})}>{c.first}</Button><Button variant="secondary" disabled={!directory.nextCursor||state.writing} onClick={()=>navigate({...state.scope,cursor:directory.nextCursor})}>{c.next}</Button></div>
   </>:<Notice tone="error">{state.directory&&!state.directory.ok?c.errors[state.directory.code]:c.errors.UNAVAILABLE}</Notice>}
  </Card>
  {writeReady&&directory?<TeamOwnerEditor key={`${state.scope.teamId??"new"}:${directory.team?.revision??"list"}`} actorId={actorId} directory={directory} selection={selection} store={store} copy={c} onSelection={()=>setSelection(null)}/>:null}
 </div></Container>;
}

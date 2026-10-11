"use client";
import {useEffect,useId,useLayoutEffect,useRef,useState,useSyncExternalStore} from "react";
import {adminSearchAccounts} from "@/lib/tenancy/actions";
import {accessGetUserSnapshot} from "@/lib/access/actions";
import {readPlatformTeamDirectory} from "@/lib/platform-teams/actions";
import {TEAM_FAILURES,teamUuid,type TeamFailure,type Team,type TeamDirectory,type TeamMember} from "@/lib/platform-teams/contracts";
import {readTeamMemberRevision,type TeamInput,type TeamUiStore} from "@/lib/platform-teams/ui-state";
import {Button,Card,Field,Notice,useUnsavedWarning} from "@/components/app/ui";
import type {TeamCopy} from "./copy";

type AccountChoice={userId:string;label:string};
const rejectRead=(store:TeamUiStore,code:string)=>store.rejectRead(TEAM_FAILURES.includes(code as TeamFailure["code"])?code as TeamFailure["code"]:"UNAVAILABLE");
type FormProps={actorId:string;store:TeamUiStore;copy:TeamCopy};
// Entered intent lives only in the actor/context store, never in roster or browser persistence.
function useDraft<T>(store:TeamUiStore,key:string,initial:T){
 const [value,setValue]=useState<T>(()=>(store.readDraft(key) as T|undefined)??initial);
 const change=(next:T)=>{store.saveDraft(key,next);setValue(next);};
 return [value,change] as const;
}
function Reason({value,onChange,copy:c}:{value:string;onChange:(v:string)=>void;copy:TeamCopy}){return <Field label={c.reason} required hint={c.reasonHint}>{p=><textarea {...p} value={value} maxLength={240} rows={3} onChange={e=>onChange(e.target.value)} required minLength={2}/>}</Field>;}
function AccountPicker({store,copy:c,manager,onSelect}:{store:TeamUiStore;copy:TeamCopy;manager?:boolean;onSelect:(value:AccountChoice)=>void}){
 const [query,setQuery]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[hits,setHits]=useState<AccountChoice[]|null>(null);
 const [page,setPage]=useState<{offset:number;next:number|null}>({offset:0,next:null});
 const gen=useRef(0),mounted=useRef(false);
 useEffect(()=>{mounted.current=true;const counter=gen;return()=>{mounted.current=false;counter.current++;};},[]);
 const current=(n:number)=>mounted.current&&gen.current===n&&store.isCurrent();
 async function search(offset=0){if(busy||!store.isCurrent())return;const n=++gen.current;setBusy(true);setError(null);setHits(null);try{const r=await adminSearchAccounts({query,limit:20,offset});if(!current(n))return;if(!r.ok){rejectRead(store,r.code);setError(c.errors[r.code as keyof TeamCopy["errors"]]??c.errors.UNAVAILABLE);return;}setPage({offset:r.data.offset,next:r.data.hasMore&&!r.data.atBrowseWindowEnd&&r.data.offset+r.data.limit<=r.data.maxOffset?r.data.offset+r.data.limit:null});setHits(r.data.rows.filter(row=>teamUuid(row.user_id)).map(row=>({userId:row.user_id,label:[row.full_name,row.email,row.support_code].filter(Boolean).join(" · ")||c.unavailableName})));}catch{if(current(n)){rejectRead(store,"UNAVAILABLE");setError(c.errors.UNAVAILABLE);}}finally{if(current(n))setBusy(false);}}
 async function select(value:AccountChoice){if(busy||!store.isCurrent())return;const n=++gen.current;setBusy(true);setError(null);try{if(manager){const r=await accessGetUserSnapshot(value.userId);if(!current(n))return;if(!r.ok)rejectRead(store,r.code);if(!r.ok||r.data.userId!==value.userId||r.data.platform?.role!=="delegated"||r.data.platform.status!=="active"){setError(r.ok?c.errors.INVALID_MEMBER:c.errors[r.code]);return;}}if(current(n))onSelect(value);}catch{if(current(n)){rejectRead(store,"UNAVAILABLE");setError(c.errors.UNAVAILABLE);}}finally{if(current(n))setBusy(false);}}
 return <div className="grid gap-3 rounded-xl border border-[color:var(--color-border-soft)] p-3">
  <Field label={c.accountSearch}>{p=><input {...p} value={query} maxLength={120} onChange={e=>{gen.current++;setBusy(false);setError(null);setQuery(e.target.value);setPage({offset:0,next:null});setHits(null);store.invalidateReview();}}/>}</Field>
  <Button type="button" variant="secondary" busy={busy} onClick={()=>void search()}>{c.find}</Button>
  {hits?<div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" disabled={busy||page.offset===0} onClick={()=>void search()}>{c.first}</Button><Button type="button" variant="ghost" disabled={busy||page.next===null} onClick={()=>void search(page.next??0)}>{c.next}</Button></div>:null}
  {manager?<p className="text-sm">{c.managerEligibility}</p>:null}
  {error?<Notice tone="error">{error}</Notice>:null}
  {hits?.length===0?<p>{c.noAccounts}</p>:null}
  {hits?.map(hit=><div key={hit.userId} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words text-sm">{hit.label}</span><Button type="button" variant="ghost" disabled={busy} onClick={()=>void select(hit)}>{c.select}</Button></div>)}
 </div>;
}

export function TeamForm({actorId,store,copy:c,team,members=[]}:FormProps&{team:Team|null;members?:TeamMember[]}){
 const prefix=`team:${team?.id??"new"}:`;
 const [name,setName]=useDraft(store,prefix+"name",team?.name??""),[status,setStatus]=useDraft<"active"|"disabled">(store,prefix+"status",team?.status??"active"),[reason,setReason]=useDraft(store,prefix+"reason","");
 const [manager,setManager]=useDraft<AccountChoice|null>(store,prefix+"manager",team?.managerUserId?{userId:team.managerUserId,label:members.find(m=>m.userId===team.managerUserId)?.fullName||c.unavailableName}:null);
 useUnsavedWarning(Boolean(reason||name!==(team?.name??"")));
 const edit=()=>store.invalidateReview();
 return <Card title={team?c.editTeam:c.create}><form className="grid gap-4" onSubmit={e=>{e.preventDefault();void store.review({expectedUserId:actorId,operationId:crypto.randomUUID(),op:team?"update":"create",teamId:team?.id??crypto.randomUUID(),name,...(team?{status}:{}),managerUserId:status==="active"?manager?.userId??null:null,reason,expectedTeamRevision:team?.revision??0} satisfies TeamInput);}}>
  <Field label={c.name} required hint={c.nameHint}>{p=><input {...p} required minLength={2} maxLength={120} value={name} onChange={e=>{setName(e.target.value);edit();}}/>}</Field>
  {team?<Field label={c.status} required>{p=><select {...p} value={status} onChange={e=>{setStatus(e.target.value as "active"|"disabled");edit();}}><option value="active">{c.active}</option><option value="disabled">{c.disabled}</option></select>}</Field>:null}
  {status==="active"?<><p>{c.manager}: {manager?.label??c.none}</p><AccountPicker store={store} copy={c} manager onSelect={v=>{setManager(v);edit();}}/></>:null}
  <Reason value={reason} copy={c} onChange={v=>{setReason(v);edit();}}/>
  <Button type="submit" disabled={status==="active"&&!manager}>{c.review}</Button>
 </form></Card>;
}

function MemberForm({actorId,store,copy:c,team,member}:FormProps&{team:Team;member:TeamMember|null}){
 const prefix=`member:${team.id}:${member?.userId??"enroll"}:`;
 const [choice,setChoice]=useDraft<AccountChoice|null>(store,prefix+"choice",member?{userId:member.userId,label:member.fullName||c.unavailableName}:null);
 const [base,setBase]=useState<{team:Team;member:TeamMember|null}|null>(member?{team,member}:null);
 const [status,setStatus]=useDraft<"active"|"disabled">(store,prefix+"status",member?.status??"active"),[specialty,setSpecialty]=useDraft(store,prefix+"specialty",member?.specialty??""),[reason,setReason]=useDraft(store,prefix+"reason",""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const gen=useRef(0);useEffect(()=>{const counter=gen;return()=>{counter.current++;};},[]);
 useUnsavedWarning(Boolean(reason));
 async function select(value:AccountChoice,restoring=false){const n=++gen.current;store.invalidateReview();setChoice(value);setBase(null);setBusy(true);setError(null);
  const r=await readTeamMemberRevision({actorId,teamId:team.id,userId:value.userId,readDirectory:readPlatformTeamDirectory,isCurrent:()=>store.isCurrent()&&n===gen.current});
  if(!store.isCurrent()||n!==gen.current)return;
  if(r.ok){setChoice(value);setBase(r.data);if(!restoring){setStatus(r.data.member?.status??"active");setSpecialty(r.data.member?.specialty??"");}}else {rejectRead(store,r.code);setError(c.errors[r.code]);}setBusy(false);
 }
 const edit=()=>store.invalidateReview();
 return <Card title={c.enroll}><form className="grid gap-4" onSubmit={e=>{e.preventDefault();if(!base||!choice)return;void store.review({expectedUserId:actorId,operationId:crypto.randomUUID(),op:"set_member",reason,teamId:base.team.id,userId:choice.userId,status,specialty,expectedTeamRevision:base.team.revision,expectedMemberRevision:base.member?.revision??0});}}>
  {member?<p>{c.selected}: {choice?.label}</p>:<AccountPicker store={store} copy={c} onSelect={v=>void select(v)}/>}
  {busy?<p role="status" aria-busy="true">{c.loading}</p>:null}{error?<Notice tone="error">{error}</Notice>:null}
  {!member&&choice?<><p>{c.selected}: {choice.label}</p>{!base?<Button type="button" busy={busy} variant="secondary" onClick={()=>void select(choice,true)}>{c.refresh}</Button>:null}</>:null}
  <Field label={c.status} required>{p=><select {...p} value={status} disabled={!base||busy} onChange={e=>{setStatus(e.target.value as "active"|"disabled");edit();}}><option value="active" disabled={base?.team.status==="disabled"}>{c.active}</option><option value="disabled" disabled={base?.team.status==="active"&&base.team.managerUserId===choice?.userId}>{c.disabled}</option></select>}</Field>
  <Field label={c.specialty} hint={c.specialtyHint}>{p=><input {...p} maxLength={120} value={specialty} onChange={e=>{setSpecialty(e.target.value);edit();}}/>}</Field>
  <Reason value={reason} copy={c} onChange={v=>{setReason(v);edit();}}/>
  <Button type="submit" disabled={!base||!choice||busy||status==="active"&&base.team.status!=="active"}>{c.review}</Button>
 </form></Card>;
}

function TransferForm({actorId,store,copy:c,team,member}:FormProps&{team:Team;member:TeamMember}){
 const prefix=`transfer:${team.id}:${member.userId}:`;
 const [search,setSearch]=useDraft(store,prefix+"search",""),[list,setList]=useState<TeamDirectory|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[reason,setReason]=useDraft(store,prefix+"reason","");
 const [chosen,setChosen]=useDraft<{id:string;label:string}|null>(store,prefix+"chosen",null);
 const [destination,setDestination]=useState<{team:Team;member:TeamMember|null;managerName:string}|null>(null);
 const gen=useRef(0);useEffect(()=>{const counter=gen;return()=>{counter.current++;};},[]);useUnsavedWarning(Boolean(reason));
 async function searchTeams(cursor:TeamDirectory["nextCursor"]=null){const n=++gen.current;setBusy(true);setError(null);setList(null);store.invalidateReview();try{const r=await readPlatformTeamDirectory({expectedUserId:actorId,teamId:null,pageSize:25,search,cursor});if(!store.isCurrent()||n!==gen.current)return;if(r.ok)setList(r.data);else {rejectRead(store,r.code);setError(c.errors[r.code]);}}catch{if(store.isCurrent()&&n===gen.current){rejectRead(store,"UNAVAILABLE");setError(c.errors.UNAVAILABLE);}}finally{if(store.isCurrent()&&n===gen.current)setBusy(false);}}
 async function select(destinationTeam:Pick<Team,"id">){const n=++gen.current;setBusy(true);setDestination(null);setError(null);store.invalidateReview();const isCurrent=()=>store.isCurrent()&&n===gen.current;
  const r=await readTeamMemberRevision({actorId,teamId:destinationTeam.id,userId:member.userId,readDirectory:readPlatformTeamDirectory,isCurrent});
  if(!isCurrent())return;if(!r.ok){rejectRead(store,r.code);setError(c.errors[r.code]);setBusy(false);return;}
  if(r.data.team.status!=="active"||!r.data.team.managerUserId){setError(c.errors.INVALID_MEMBER);setBusy(false);return;}
  const manager=await readTeamMemberRevision({actorId,teamId:r.data.team.id,userId:r.data.team.managerUserId,readDirectory:readPlatformTeamDirectory,isCurrent});
  if(!isCurrent())return;
  if(!manager.ok||manager.data.team.revision!==r.data.team.revision){rejectRead(store,manager.ok?"CONFLICT":manager.code);setError(c.errors[manager.ok?"CONFLICT":manager.code]);setBusy(false);return;}
  setChosen({id:r.data.team.id,label:r.data.team.name});setDestination({...r.data,managerName:manager.data.member?.fullName||c.unavailableName});setBusy(false);
 }
 return <Card title={c.transfer}><form className="grid gap-4" onSubmit={e=>{e.preventDefault();if(!destination)return;void store.review({expectedUserId:actorId,operationId:crypto.randomUUID(),op:"transfer",reason,sourceTeamId:team.id,destinationTeamId:destination.team.id,userId:member.userId,expectedSourceRevision:team.revision,expectedDestinationRevision:destination.team.revision,expectedMemberRevision:member.revision,expectedDestinationMemberRevision:destination.member?.revision??0});}}>
  <p>{member.fullName||c.unavailableName} · {c.source}: {team.name} · {team.status==="active"?c.active:c.disabled}</p>
  <p className="text-sm">{c.transferConsequence}</p>
  <Field label={c.pickDestination}>{p=><input {...p} value={search} maxLength={120} onChange={e=>{gen.current++;setBusy(false);setError(null);setDestination(null);setChosen(null);setSearch(e.target.value);setList(null);store.invalidateReview();}}/>}</Field>
  <Button type="button" variant="secondary" busy={busy} onClick={()=>void searchTeams()}>{c.find}</Button>
  {error?<Notice tone="error">{error}</Notice>:null}
  {list?.rows.map(row=>"id"in row?<div key={row.id} className="flex flex-wrap items-center justify-between gap-2"><p>{row.name} · {row.status==="active"?c.active:c.disabled}</p><Button type="button" variant="ghost" disabled={busy||row.id===team.id||row.status!=="active"} onClick={()=>void select(row)}>{c.select}</Button></div>:null)}
  {list?.rows.length===0?<p>{c.empty}</p>:null}{list?.nextCursor?<Button type="button" variant="secondary" disabled={busy} onClick={()=>void searchTeams(list.nextCursor)}>{c.next}</Button>:null}
  {chosen&&!destination?<div><p>{c.destination}: {chosen.label}</p><Button type="button" variant="secondary" busy={busy} onClick={()=>void select({id:chosen.id})}>{c.refresh}</Button></div>:null}
  {destination?<dl className="grid gap-1"><div><dt className="inline">{c.destination}: </dt><dd className="inline">{destination.team.name}</dd></div><div><dt className="inline">{c.after}: </dt><dd className="inline">{destination.managerName}</dd></div><div><dt className="inline">{c.destinationMembership}: </dt><dd className="inline">{destination.member?(destination.member.status==="active"?c.active:c.disabled):c.absent}</dd></div></dl>:null}
  <Reason copy={c} value={reason} onChange={v=>{setReason(v);store.invalidateReview();}}/>
  <Button type="submit" disabled={!destination||busy||member.status!=="active"}>{c.review}</Button>
 </form></Card>;
}

export function TeamOwnerEditor({actorId,directory,selection,store,copy:c,onSelection}:FormProps&{directory:TeamDirectory;selection:{member:TeamMember;transfer:boolean}|null;onSelection:()=>void}){
 const state=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 const reviewRef=useRef<HTMLElement>(null),returnFocusRef=useRef<HTMLElement|null>(null),reviewTitle=useId();
 const reviewing=Boolean(state.review);
 useLayoutEffect(()=>{
  if(reviewing)reviewRef.current?.focus();
  else {const origin=returnFocusRef.current;returnFocusRef.current=null;if(origin?.isConnected&&store.isCurrent())origin.focus();}
 },[reviewing,store]);
 const team=directory.team,members=directory.kind==="members"?directory.rows as TeamMember[]:[];
 const selected=selection?members.find(m=>m.userId===selection.member.userId)??null:null;
 return <div className="grid min-w-0 gap-5" onSubmitCapture={()=>{returnFocusRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;}}>
  {state.preparing?<Notice>{c.loading}</Notice>:null}
  {state.review?<section ref={reviewRef} tabIndex={-1} aria-labelledby={reviewTitle} onKeyDown={event=>{if(event.key==="Escape"&&!state.writing){event.preventDefault();event.stopPropagation();store.invalidateReview();}}}><Card><h2 id={reviewTitle} className="mb-4 text-lg font-bold">{c.confirm}</h2><div className="grid gap-3">
   <p>{state.review.op==="transfer"?c.transferConsequence:c.changeConsequence}</p>
   {state.preview?<dl className="grid gap-2"><div><dt className="inline">{c.source}: </dt><dd className="inline">{state.preview.sourceTeam.name}</dd></div><div><dt className="inline">{c.destination}: </dt><dd className="inline">{state.preview.destinationTeam.name}</dd></div><div><dt className="inline">{c.before}: </dt><dd className="inline">{state.preview.managerBefore?members.find(m=>m.userId===state.preview!.managerBefore)?.fullName||c.unavailableName:c.none}</dd></div><div><dt className="inline">{c.destinationMembership}: </dt><dd className="inline">{state.preview.destinationMember?(state.preview.destinationMember.status==="active"?c.active:c.disabled):c.absent}</dd></div></dl>:<><p>{state.review.name?`${c.name}: ${state.review.name}`:selected?.fullName||c.enroll}</p>{state.review.status?<p>{c.status}: {state.review.status==="active"?c.active:c.disabled}</p>:null}{state.review.specialty?<p>{c.specialty}: {String(state.review.specialty)}</p>:null}</>}
   <p>{c.reason}: {state.review.reason}</p><div className="flex flex-wrap gap-2"><Button type="button" busy={state.writing} busyLabel={c.saving} onClick={()=>{void store.commit().then(()=>{if(store.isCurrent()&&store.getSnapshot().confirmed)onSelection();});}}>{c.confirm}</Button><Button type="button" variant="secondary" disabled={state.writing} onClick={()=>store.invalidateReview()}>{c.cancel}</Button></div>
  </div></Card></section>:null}
  <fieldset disabled={Boolean(state.review)||state.preparing} className="grid min-w-0 gap-5">
   {selected&&team&&selection?.transfer?<TransferForm key={`transfer:${selected.userId}:${selected.revision}`} actorId={actorId} store={store} copy={c} team={team} member={selected}/>:selected&&team?<MemberForm key={`member:${selected.userId}:${selected.revision}`} actorId={actorId} store={store} copy={c} team={team} member={selected}/>:null}
   {selection?<Button type="button" variant="ghost" onClick={()=>{store.invalidateReview();onSelection();}}>{c.cancel}</Button>:null}
   {!selection?<><TeamForm actorId={actorId} store={store} copy={c} team={team} members={members}/>{team?<MemberForm actorId={actorId} store={store} copy={c} team={team} member={null}/>:null}</>:null}
  </fieldset>
 </div>;
}

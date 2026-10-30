import {describe, expect, it} from "vitest";
import type {Team, TeamDirectory, TeamMember, TeamMutation, TeamResult, TransferPreview} from "./contracts";
import type {TeamUiApi} from "./ui-state";

const subject = await import("./ui-state").catch(() => null);
const id = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor=id(1), a=id(10), b=id(11), person=id(20);
const team=(teamId=a,revision=1,status:"active"|"disabled"="active"):Team=>({id:teamId,name:teamId===a?"Team A":"Team B",status,managerUserId:status==="active"?id(30):null,revision});
const member=(teamId=a,status:"active"|"disabled"="active",revision=2):TeamMember=>({teamId,userId:person,status,revision,specialty:"Support",role:"employee",fullName:"Synthetic employee"});
const page=(teamId:string|null=a,rows:TeamMember[]=[],nextCursor:TeamDirectory["nextCursor"]=null):TeamResult<TeamDirectory>=>({ok:true,data:{kind:teamId?"members":"teams",rows,total:rows.length,team:teamId?team(teamId):null,nextCursor}});
const input=()=>({expectedUserId:actor,operationId:id(50),op:"set_member",reason:"Owner requested update",teamId:a,userId:person,status:"disabled",specialty:"Support",expectedTeamRevision:1,expectedMemberRevision:2});
const transfer=()=>({expectedUserId:actor,operationId:id(51),op:"transfer",reason:"Move selected membership",sourceTeamId:a,destinationTeamId:b,userId:person,expectedSourceRevision:1,expectedDestinationRevision:1,expectedMemberRevision:2,expectedDestinationMemberRevision:7});
const preview:TeamResult<TransferPreview>={ok:true,data:{sourceTeam:team(a,1,"disabled"),destinationTeam:team(b),sourceMember:member(a),destinationMember:member(b,"disabled",7),managerBefore:null,managerAfter:id(30)}};
const confirmed=(request:Record<string,unknown>):TeamResult<TeamMutation>=>({ok:true,data:{actorUserId:actor,accessNeedsRecheck:false,operationId:request.operationId as string,op:request.op as TeamMutation["op"],team:team(a,2),member:member(a,"disabled",3)}});
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
function storage(){const entries=new Map<string,string>();return {getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);},entries};}
function setup(){
 expect(subject?.createTeamUiStore).toBeTypeOf("function");
 let current=true,writeAllowed=true;
 const submitted:Array<Record<string,unknown>>=[];
 const memory=storage();
 const api:TeamUiApi={readDirectory:async()=>page(),preview:async()=>preview,mutate:async(request:unknown)=>{submitted.push(request as Record<string,unknown>);return confirmed(request as Record<string,unknown>);}};
 const store=subject!.createTeamUiStore({actorId:actor,api,storage:()=>memory,isCurrentActor:()=>current,canWrite:()=>writeAllowed});
 return {store,api,memory,submitted,setCurrent:(v:boolean)=>{current=v;},setWrite:(v:boolean)=>{writeAllowed=v;}};
}

describe("team UI authority, revision reads and replay",()=>{
 it("joins same-scope in-flight loads but refreshes after settlement",async()=>{
  const s=setup(),read=deferred<TeamResult<TeamDirectory>>();let calls=0;
  s.api.readDirectory=async()=>{calls++;return read.promise;};s.store.activate();
  const first=s.store.load({teamId:a,search:""}),second=s.store.load({teamId:a,search:""});
  expect(calls).toBe(1);read.resolve(page(a));expect(await first).toBe(true);expect(await second).toBe(true);
  await s.store.load({teamId:a,search:""});expect(calls).toBe(2);
 });
 it("does not join a pending read after suspend or revocation",async()=>{
  const s=setup(),old=deferred<TeamResult<TeamDirectory>>(),fresh=deferred<TeamResult<TeamDirectory>>();let calls=0;
  s.api.readDirectory=async()=>++calls===1?old.promise:fresh.promise;s.store.activate();
  const first=s.store.load({teamId:a,search:""});s.store.suspend();s.store.activate();
  const second=s.store.load({teamId:a,search:""});expect(calls).toBe(2);
  old.resolve(page(a,[member()]));expect(await first).toBe(false);expect(s.store.getSnapshot().directory).toBeNull();
  fresh.resolve(page(a));expect(await second).toBe(true);
 });
 it("an auxiliary roster lookup denial clears protected rows and invalidates old read responses",async()=>{
  const s=setup(),read=deferred<TeamResult<TeamDirectory>>();s.store.activate();await s.store.load({teamId:a,search:""});s.api.readDirectory=async()=>read.promise;const loading=s.store.load({teamId:a,search:""});s.store.saveDraft("reason","Entered intent");
  s.store.rejectRead("FORBIDDEN");read.resolve(page(a,[member()]));await loading;expect(s.store.getSnapshot().directory).toBeNull();expect(s.store.readDraft("reason")).toBeUndefined();expect(s.store.getSnapshot().error).toBe("FORBIDDEN");
 });
 it("same-context refresh preserves entered draft intent, but revocation and context change clear it",async()=>{
  const s=setup();s.store.activate();s.store.saveDraft("reason","Keep entered reason");await s.store.load({teamId:a,search:""});expect(s.store.readDraft("reason")).toBe("Keep entered reason");
  s.api.readDirectory=async()=>({ok:false,code:"FORBIDDEN"});await s.store.load({teamId:a,search:""});expect(s.store.readDraft("reason")).toBeUndefined();
  s.store.saveDraft("reason","Different draft");s.store.bindAuthority(()=>true,()=>true,"new-scope");expect(s.store.readDraft("reason")).toBeUndefined();
 });
 it("binding a new role/URL context clears current rows and rejects old responses before activation",async()=>{
  const s=setup(),read=deferred<TeamResult<TeamDirectory>>();s.store.activate();await s.store.load({teamId:a,search:""});s.api.readDirectory=async()=>read.promise;const old=s.store.load({teamId:a,search:""});
  s.store.bindAuthority(()=>true,()=>false,"delegated:new-url");
  expect(s.store.getSnapshot().directory).toBeNull();expect(s.store.getSnapshot().contextKey).toBe("delegated:new-url");
  read.resolve(page(a,[member()]));await old;expect(s.store.getSnapshot().directory).toBeNull();expect(s.store.isCurrent()).toBe(false);
 });
 it("a late pre-write roster read cannot repopulate rows after mutation revocation",async()=>{
  const s=setup(),read=deferred<TeamResult<TeamDirectory>>();s.store.activate();s.api.readDirectory=async()=>read.promise;
  const loading=s.store.load({teamId:a,search:""});s.api.mutate=async()=>({ok:false,code:"FORBIDDEN"});await s.store.review(input());await s.store.commit();
  read.resolve(page(a,[member()]));await loading;expect(s.store.getSnapshot().directory).toBeNull();expect(s.store.getSnapshot().loading).toBe(false);expect(s.store.getSnapshot().uncertain).toBe(true);
 });
 it("a denied preview invalidates an earlier in-flight directory response",async()=>{
  const s=setup(),read=deferred<TeamResult<TeamDirectory>>();s.store.activate();s.api.readDirectory=async()=>read.promise;
  const loading=s.store.load({teamId:a,search:""});s.api.preview=async()=>({ok:false,code:"FORBIDDEN"});await s.store.review(transfer());
  read.resolve(page(a,[member()]));await loading;expect(s.store.getSnapshot().directory).toBeNull();expect(s.store.getSnapshot().loading).toBe(false);
 });
 it("a revoked preview clears previously loaded protected rows and cannot confirm",async()=>{
  const s=setup();s.store.activate();await s.store.load({teamId:a,search:""});
  s.api.preview=async()=>({ok:false,code:"FORBIDDEN"});await s.store.review(transfer());await s.store.commit();
  expect(s.store.getSnapshot().directory).toBeNull();expect(s.store.getSnapshot().error).toBe("FORBIDDEN");expect(s.submitted).toEqual([]);
 });
 it("a later successful refresh clears the old conflict error",async()=>{
  const s=setup();s.store.activate();s.api.mutate=async()=>({ok:false,code:"CONFLICT"});await s.store.review(input());await s.store.commit();await s.store.load({teamId:a,search:""});
  expect(s.store.getSnapshot().error).toBeNull();expect(s.store.getSnapshot().directory?.ok).toBe(true);
 });
 it("rejects writes when the route is read-only even with a valid draft",async()=>{
  const s=setup();s.setWrite(false);s.store.activate();await s.store.review(input());await s.store.commit();
  expect(s.submitted).toEqual([]);expect(s.store.getSnapshot().error).toBe("FORBIDDEN");
 });
 it("requires a validated reason before preparing or sending a write",async()=>{
  const s=setup();s.store.activate();await s.store.review({...input(),reason:"x"});await s.store.commit();
  expect(s.submitted).toEqual([]);expect(s.store.getSnapshot().error).toBe("INVALID_INPUT");
 });
 it("discarded A→B directory responses cannot restore A or clear B's loading state",async()=>{
  const s=setup(),old=deferred<TeamResult<TeamDirectory>>(),latest=deferred<TeamResult<TeamDirectory>>();
  let n=0;s.api.readDirectory=async()=>++n===1?old.promise:latest.promise;s.store.activate();
  const first=s.store.load({teamId:a,search:""});const second=s.store.load({teamId:b,search:""});
  old.resolve(page(a,[member(a)]));await first;
  expect(s.store.getSnapshot().directory).toBeNull();expect(s.store.getSnapshot().loading).toBe(true);
  latest.resolve(page(b,[member(b)]));await second;
  expect(s.store.getSnapshot().directory?.ok).toBe(true);expect(s.store.getSnapshot().scope.teamId).toBe(b);
 });
 it("scope-bound cursors reset when changing search or team",async()=>{
  const s=setup(),requests:Array<Record<string,unknown>>=[];s.api.readDirectory=async r=>{requests.push(r as Record<string,unknown>);return page();};s.store.activate();
  const cursor={id:person,revision:2,actorUserId:actor,teamId:a,search:"old",scopeRevision:"a".repeat(32)};
  await s.store.load({teamId:a,search:"new",cursor});
  expect(requests[0].cursor).toBeNull();expect(requests[0].search).toBe("new");
 });
 it("requires a transfer preview and invalidates it when the reason changes",async()=>{
  const s=setup();s.store.activate();await s.store.review(transfer());expect(s.store.getSnapshot().preview?.sourceTeam.status).toBe("disabled");
  s.store.invalidateReview();await s.store.commit();expect(s.submitted).toEqual([]);
 });
 it("preserves the disabled source team and captured disabled destination revision through confirmation",async()=>{
  const s=setup();s.store.activate();await s.store.review(transfer());await s.store.commit();
  expect(s.submitted[0]).toEqual(transfer());expect(s.submitted[0].expectedDestinationMemberRevision).toBe(7);
 });
 it("a rejected disabled source membership preview never submits",async()=>{
  const s=setup();s.api.preview=async()=>({ok:false,code:"INVALID_MEMBER"});s.store.activate();await s.store.review(transfer());await s.store.commit();
  expect(s.submitted).toEqual([]);expect(s.store.getSnapshot().error).toBe("INVALID_MEMBER");
 });
 it("double confirmation sends one mutation while the first is pending",async()=>{
  const s=setup(),pending=deferred<TeamResult<TeamMutation>>();s.api.mutate=async r=>{s.submitted.push(r as Record<string,unknown>);return pending.promise;};s.store.activate();await s.store.review(input());
  const first=s.store.commit();await s.store.commit();expect(s.submitted).toHaveLength(1);pending.resolve(confirmed(input()));await first;
 });
 it("network loss survives reload and retries the exact UUID and payload",async()=>{
  const s=setup();s.api.mutate=async r=>{s.submitted.push(r as Record<string,unknown>);throw Error("response lost");};s.store.activate();await s.store.review(input());await s.store.commit();
  expect(s.store.getSnapshot().uncertain).toBe(true);
  const recovered=subject!.createTeamUiStore({actorId:actor,api:{...s.api,mutate:async r=>{s.submitted.push(r as Record<string,unknown>);return confirmed(r as Record<string,unknown>);}},storage:()=>s.memory,isCurrentActor:()=>true,canWrite:()=>true});
  recovered.activate();await recovered.retry();expect(s.submitted).toEqual([input(),input()]);expect(recovered.getSnapshot().confirmed).toBe(true);
 });
 it("an uncertain pending operation blocks a different new write",async()=>{
  const s=setup();s.api.mutate=async()=>({ok:false,code:"UNAVAILABLE"});s.store.activate();await s.store.review(input());await s.store.commit();
  await s.store.review({...input(),operationId:id(90),reason:"Different intent"});expect(s.store.getSnapshot().review).toBeNull();expect(s.store.getSnapshot().uncertain).toBe(true);
 });
 it("storage failure prevents transport rather than sacrificing reload replay safety",async()=>{
  const s=setup();s.memory.setItem=()=>{throw Error("storage unavailable");};s.store.activate();await s.store.review(input());await s.store.commit();
  expect(s.submitted).toEqual([]);expect(s.store.getSnapshot().error).toBe("RETRY_STORAGE");
 });
 it("confirmed save remains confirmed after refresh fails and protected rows disappear",async()=>{
  const s=setup();s.api.readDirectory=async()=>({ok:false,code:"UNAVAILABLE"});s.store.activate();await s.store.review(input());await s.store.commit();
  expect(s.store.getSnapshot().confirmed).toBe(true);expect(s.store.getSnapshot().uncertain).toBe(false);expect(s.store.getSnapshot().directory).toEqual({ok:false,code:"UNAVAILABLE"});
  const saved=JSON.parse([...s.memory.entries.values()][0]);expect(saved.phase).toBe("confirmed");expect(saved.request).toBeUndefined();expect(saved.operationId).toBe(id(50));
 });
 it("revision conflicts discard confirmation and do not auto-overwrite or generate another operation",async()=>{
  const s=setup();s.api.mutate=async r=>{s.submitted.push(r as Record<string,unknown>);return {ok:false,code:"CONFLICT"};};s.store.activate();await s.store.review(input());await s.store.commit();
  expect(s.store.getSnapshot().review).toBeNull();expect(s.store.getSnapshot().error).toBe("CONFLICT");expect(s.submitted).toEqual([input()]);expect(s.memory.entries.size).toBe(0);
 });
 it("logout while a write is pending cannot restore data or confirmation",async()=>{
  const s=setup(),pending=deferred<TeamResult<TeamMutation>>();s.api.mutate=async()=>pending.promise;s.store.activate();await s.store.review(input());const write=s.store.commit();
  s.setCurrent(false);s.store.suspend();pending.resolve(confirmed(input()));await write;
  expect(s.store.getSnapshot().confirmed).toBe(false);expect(s.store.getSnapshot().directory).toBeNull();expect(s.store.getSnapshot().review).toBeNull();
 });
 it("a new actor clears the old journal and never receives its pending payload",async()=>{
  const s=setup();s.api.mutate=async()=>({ok:false,code:"UNAVAILABLE"});s.store.activate();await s.store.review(input());await s.store.commit();
  const next=subject!.createTeamUiStore({actorId:id(2),api:s.api,storage:()=>s.memory,isCurrentActor:()=>true,canWrite:()=>true});next.activate();expect(next.getSnapshot().uncertain).toBe(false);expect(s.memory.entries.size).toBe(0);
 });
 it("rejects journal extra fields, cross-actor payloads and oversized input without execution",()=>{
  const s=setup();for(const request of [{...input(),expectedUserId:id(2)},{...input(),token:"forged"},{...input(),reason:"x".repeat(5000)}]){
   s.memory.setItem(subject!.TEAM_JOURNAL_KEY,JSON.stringify({version:1,actorId:actor,phase:"pending",request}));s.store.activate();expect(s.store.getSnapshot().uncertain).toBe(false);expect(s.memory.entries.size).toBe(0);
  }expect(s.submitted).toEqual([]);
 });
 it("authoritative lookup follows all pages and includes a disabled destination membership",async()=>{
  expect(subject?.readTeamMemberRevision).toBeTypeOf("function");let calls=0;
  const cursor={id:id(19),revision:1,actorUserId:actor,teamId:b,search:"",scopeRevision:"b".repeat(32)};
  const read=async()=>{calls++;return calls===1?page(b,[{...member(b),userId:id(19)}],cursor):page(b,[member(b,"disabled",7)]);};
  const result=await subject!.readTeamMemberRevision({actorId:actor,teamId:b,userId:person,readDirectory:read,isCurrent:()=>true});
  expect(result.ok&&result.data.member?.revision).toBe(7);expect(result.ok&&result.data.member?.status).toBe("disabled");expect(calls).toBe(2);
 });
 it("absence is established only after the final authoritative page",async()=>{
  expect(subject?.readTeamMemberRevision).toBeTypeOf("function");let calls=0;const cursor={id:id(19),revision:1,actorUserId:actor,teamId:b,search:"",scopeRevision:"b".repeat(32)};
  const result=await subject!.readTeamMemberRevision({actorId:actor,teamId:b,userId:person,readDirectory:async()=>{calls++;return calls===1?page(b,[{...member(b),userId:id(19)}],cursor):page(b,[]);},isCurrent:()=>true});
  expect(result).toEqual({ok:true,data:{team:team(b),member:null}});expect(calls).toBe(2);
 });
 it("a lookup interrupted by revision conflict does not invent absence",async()=>{
  expect(subject?.readTeamMemberRevision).toBeTypeOf("function");const result=await subject!.readTeamMemberRevision({actorId:actor,teamId:b,userId:person,readDirectory:async()=>({ok:false,code:"CONFLICT"}),isCurrent:()=>true});expect(result).toEqual({ok:false,code:"CONFLICT"});
 });
});

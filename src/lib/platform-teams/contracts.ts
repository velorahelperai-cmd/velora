export const TEAM_FAILURES = ["UNAUTHENTICATED","UNVERIFIED","FORBIDDEN","INVALID_INPUT","UNAVAILABLE","NOT_FOUND","CONFLICT","INVALID_MEMBER","MANAGER_REQUIRED","TRANSFER_REQUIRED","OPERATION_CONFLICT"] as const;
export type TeamFailure = {ok:false;code:typeof TEAM_FAILURES[number]};
export type TeamResult<T> = {ok:true;data:T}|TeamFailure;
export type TeamStatus = "active"|"disabled";
export type Team = {id:string;name:string;status:TeamStatus;managerUserId:string|null;revision:number};
export type TeamMember = {teamId:string;userId:string;status:TeamStatus;revision:number;role?:"manager"|"employee";fullName?:string};
export type TeamSelf = {membership:TeamMember|null;team:Team|null;manager:{userId:string;fullName:string}|null};
export type TeamCursor = {id:string;revision:number};
export type DirectoryRequest = {expectedUserId:string;teamId:string|null;cursor:TeamCursor|null;pageSize:number};
export type TeamDirectory = {kind:"teams"|"members";rows:Array<(Team&{memberCount:number})|TeamMember>;total:number;nextCursor:TeamCursor|null;team:Team|null};
export type TeamOperation = "create"|"update"|"set_member"|"transfer";
export type TeamPayload = Record<string,string|number|null>&{op:TeamOperation;operation_id:string;reason:string};
export type MutationRequest = {expectedUserId:string;payload:TeamPayload};
export type TeamMutation = {actorUserId?:string;accessNeedsRecheck?:boolean;operationId:string;op:TeamOperation;team?:Team;member?:TeamMember;sourceTeam?:Team;destinationTeam?:Team;sourceMember?:TeamMember;destinationMember?:TeamMember};
export type TransferPreview = {sourceTeam:Team;destinationTeam:Team;sourceMember:TeamMember;destinationMember:TeamMember|null;managerBefore:string|null;managerAfter:string};
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
export const teamUuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const integer=(v:unknown,min=0):v is number=>typeof v==="number"&&Number.isInteger(v)&&v>=min&&v<=2147483647;
const expected=(v:unknown):v is number=>integer(v)&&v<2147483647;
const bounded=(v:unknown,min:number,max:number)=>typeof v==="string"&&v.trim().length>=min&&v.trim().length<=max;
const status=(v:unknown):v is TeamStatus=>v==="active"||v==="disabled";
const unavailable=():TeamFailure=>({ok:false,code:"UNAVAILABLE"});
function failure(v:unknown):TeamFailure|null{
 const row=object(v);if(row?.ok!==false)return null;
 return {ok:false,code:TEAM_FAILURES.includes(row.code as TeamFailure["code"])?row.code as TeamFailure["code"]:"UNAVAILABLE"};
}
function exact(row:Record<string,unknown>,keys:string[]){return Object.keys(row).every(key=>keys.includes(key));}
export function parseTeamMutation(input:unknown):MutationRequest|null{
 const row=object(input);if(!row||!teamUuid(row.expectedUserId)||!teamUuid(row.operationId)||!bounded(row.reason,2,240))return null;
 const base=["expectedUserId","operationId","reason","op"];
 const payload:TeamPayload={op:row.op as TeamOperation,operation_id:row.operationId.toLowerCase(),reason:(row.reason as string).trim()};
 if(row.op==="create"||row.op==="update"){
  const keys=[...base,"teamId","name","managerUserId","expectedTeamRevision",...(row.op==="update"?["status"]:[])];
  if(!exact(row,keys)||!teamUuid(row.teamId)||!bounded(row.name,2,120)||!expected(row.expectedTeamRevision))return null;
  if(row.op==="create"&&(row.expectedTeamRevision!==0||!teamUuid(row.managerUserId)))return null;
  if(row.op==="update"&&(!status(row.status)||row.status==="active"&&!teamUuid(row.managerUserId)||row.status==="disabled"&&row.managerUserId!==null))return null;
  Object.assign(payload,{team_id:row.teamId.toLowerCase(),name:(row.name as string).trim(),manager_user_id:typeof row.managerUserId==="string"?row.managerUserId.toLowerCase():null,expected_team_revision:row.expectedTeamRevision});
  if(row.op==="update")payload.status=row.status as TeamStatus;
 }else if(row.op==="set_member"){
  if(!exact(row,[...base,"teamId","userId","status","expectedTeamRevision","expectedMemberRevision"])||!teamUuid(row.teamId)||!teamUuid(row.userId)||!status(row.status)||!expected(row.expectedTeamRevision)||!expected(row.expectedMemberRevision))return null;
  Object.assign(payload,{team_id:row.teamId.toLowerCase(),user_id:row.userId.toLowerCase(),status:row.status,expected_team_revision:row.expectedTeamRevision,expected_member_revision:row.expectedMemberRevision});
 }else if(row.op==="transfer"){
  if(!exact(row,[...base,"sourceTeamId","destinationTeamId","userId","expectedSourceRevision","expectedDestinationRevision","expectedMemberRevision","expectedDestinationMemberRevision"])||!teamUuid(row.sourceTeamId)||!teamUuid(row.destinationTeamId)||row.sourceTeamId.toLowerCase()===row.destinationTeamId.toLowerCase()||!teamUuid(row.userId)||![row.expectedSourceRevision,row.expectedDestinationRevision,row.expectedMemberRevision,row.expectedDestinationMemberRevision].every(expected))return null;
  Object.assign(payload,{source_team_id:row.sourceTeamId.toLowerCase(),destination_team_id:row.destinationTeamId.toLowerCase(),user_id:row.userId.toLowerCase(),expected_source_revision:row.expectedSourceRevision,expected_destination_revision:row.expectedDestinationRevision,expected_member_revision:row.expectedMemberRevision,expected_destination_member_revision:row.expectedDestinationMemberRevision});
 }else return null;
 return {expectedUserId:row.expectedUserId.toLowerCase(),payload};
}
export function parseTeamDirectory(input:unknown):DirectoryRequest|null{
 const row=object(input);if(!row||!exact(row,["expectedUserId","teamId","cursor","pageSize"])||!teamUuid(row.expectedUserId))return null;
 const teamId=row.teamId??null,pageSize=row.pageSize??25;let cursor:TeamCursor|null=null;
 if(teamId!==null&&!teamUuid(teamId)||!integer(pageSize,1)||pageSize>100)return null;
 if(row.cursor!==undefined&&row.cursor!==null){const c=object(row.cursor);if(!c||!exact(c,["id","revision"])||!teamUuid(c.id)||!integer(c.revision,1))return null;cursor={id:c.id.toLowerCase(),revision:c.revision};}
 return {expectedUserId:row.expectedUserId.toLowerCase(),teamId:typeof teamId==="string"?teamId.toLowerCase():null,cursor,pageSize};
}
function team(v:unknown):Team|null{
 const r=object(v);if(!r||!teamUuid(r.id)||!bounded(r.name,2,120)||!status(r.status)||!integer(r.revision,1)||r.manager_user_id!==null&&!teamUuid(r.manager_user_id)||r.status==="active"&&r.manager_user_id===null)return null;
 return {id:r.id.toLowerCase(),name:(r.name as string),status:r.status,managerUserId:typeof r.manager_user_id==="string"?r.manager_user_id.toLowerCase():null,revision:r.revision};
}
function member(v:unknown):TeamMember|null{
 const r=object(v);if(!r||!teamUuid(r.team_id)||!teamUuid(r.user_id)||!status(r.status)||!integer(r.revision,1)||r.role!==undefined&&r.role!=="manager"&&r.role!=="employee"||r.full_name!==undefined&&typeof r.full_name!=="string")return null;
 return {teamId:r.team_id.toLowerCase(),userId:r.user_id.toLowerCase(),status:r.status,revision:r.revision,...(r.role!==undefined?{role:r.role as "manager"|"employee"}:{}),...(typeof r.full_name==="string"?{fullName:r.full_name}:{})};
}
export function decodeTeamSelf(input:unknown,userId:string):TeamResult<TeamSelf>{
 const fail=failure(input);if(fail)return fail;const r=object(input);if(r?.ok!==true)return unavailable();
 if(r.membership===null&&r.team===null&&r.manager===null)return {ok:true,data:{membership:null,team:null,manager:null}};
 const m=member(r.membership),t=team(r.team);if(!m||!t||m.userId!==userId||m.teamId!==t.id||m.status!=="active"||t.status!=="active"||m.role!==(t.managerUserId===userId?"manager":"employee"))return unavailable();
 if(t.managerUserId===userId)return r.manager===null?{ok:true,data:{membership:m,team:t,manager:null}}:unavailable();
 const manager=object(r.manager);if(!manager||manager.user_id!==t.managerUserId||typeof manager.full_name!=="string")return unavailable();
 return {ok:true,data:{membership:m,team:t,manager:{userId:manager.user_id as string,fullName:manager.full_name}}};
}
export function decodeTeamDirectory(input:unknown,request:Pick<DirectoryRequest,"teamId"|"cursor"|"pageSize">):TeamResult<TeamDirectory>{
 const fail=failure(input);if(fail)return fail;const r=object(input),kind=request.teamId===null?"teams":"members";
 if(r?.ok!==true||r.kind!==kind||!Array.isArray(r.rows)||r.rows.length>request.pageSize||!integer(r.total)||r.total<r.rows.length)return unavailable();
 const t=kind==="members"?team(r.team):null;if(kind==="members"&&(!t||t.id!==request.teamId)||kind==="teams"&&r.team!==null)return unavailable();
 const rows:TeamDirectory["rows"]=[];let previous=request.cursor?.id??"";
 for(const value of r.rows){
  const raw=object(value);if(kind==="teams"){
   const row=team(value);if(!row||!raw||!integer(raw.member_count)||row.id<=previous)return unavailable();previous=row.id;rows.push({...row,memberCount:raw.member_count});
  }else{
   const row=member(value);if(!row||row.teamId!==request.teamId||row.userId<=previous||row.role!==(row.userId===t!.managerUserId?"manager":"employee")||row.fullName===undefined)return unavailable();previous=row.userId;rows.push(row);
  }
 }
 let cursor:TeamCursor|null=null;
 if(r.next_cursor!==null){const c=object(r.next_cursor);const last=rows.at(-1);if(!c||!last||rows.length!==request.pageSize||!teamUuid(c.id)||!integer(c.revision,1)||c.id!==("id"in last?last.id:last.userId)||c.revision!==last.revision)return unavailable();cursor={id:c.id,revision:c.revision};}
 return {ok:true,data:{kind,rows,total:r.total,nextCursor:cursor,team:t}};
}
export function decodeTeamMutation(input:unknown,request:TeamPayload):TeamResult<TeamMutation>{
 const fail=failure(input);if(fail)return fail;const r=object(input);
 if(r?.ok!==true||r.operation_id!==request.operation_id||r.op!==request.op)return unavailable();
 if(request.op==="transfer"){
  const sourceTeam=team(r.source_team),destinationTeam=team(r.destination_team),sourceMember=member(r.source_member),destinationMember=member(r.destination_member);
  if(!sourceTeam||!destinationTeam||!sourceMember||!destinationMember||sourceTeam.id!==request.source_team_id||destinationTeam.id!==request.destination_team_id||sourceTeam.revision!==Number(request.expected_source_revision)+1||destinationTeam.revision!==Number(request.expected_destination_revision)+1||sourceMember.teamId!==sourceTeam.id||destinationMember.teamId!==destinationTeam.id||sourceMember.userId!==request.user_id||destinationMember.userId!==request.user_id||sourceMember.status!=="disabled"||destinationMember.status!=="active"||sourceMember.revision!==Number(request.expected_member_revision)+1||destinationMember.revision!==Number(request.expected_destination_member_revision)+1)return unavailable();
  return {ok:true,data:{operationId:request.operation_id,op:request.op,sourceTeam,destinationTeam,sourceMember,destinationMember}};
 }
 const t=team(r.team);if(!t||t.id!==request.team_id||t.revision!==Number(request.expected_team_revision)+1||r.team_id!==t.id||r.revision!==t.revision)return unavailable();
 if(request.op==="create"||request.op==="update"){
  if(t.name!==request.name||t.managerUserId!==request.manager_user_id||t.status!==(request.op==="create"?"active":request.status))return unavailable();
  return {ok:true,data:{operationId:request.operation_id,op:request.op,team:t}};
 }
 const m=member(r.member);if(!m||m.teamId!==t.id||m.userId!==request.user_id||m.status!==request.status||m.revision!==Number(request.expected_member_revision)+1||r.member_revision!==m.revision)return unavailable();
 return {ok:true,data:{operationId:request.operation_id,op:request.op,team:t,member:m}};
}
export function decodeTransferPreview(input:unknown,request:TeamPayload):TeamResult<TransferPreview>{
 const fail=failure(input);if(fail)return fail;const r=object(input);if(r?.ok!==true||request.op!=="transfer")return unavailable();
 const sourceTeam=team(r.source_team),destinationTeam=team(r.destination_team),sourceMember=member(r.source_member),destinationMember=r.destination_member===null?null:member(r.destination_member);
 const before=object(r.manager_before),after=object(r.manager_after);
 if(!sourceTeam||!destinationTeam||!sourceMember||r.destination_member!==null&&!destinationMember||sourceTeam.id!==request.source_team_id||destinationTeam.id!==request.destination_team_id||sourceTeam.revision!==request.expected_source_revision||destinationTeam.revision!==request.expected_destination_revision||sourceMember.teamId!==sourceTeam.id||sourceMember.userId!==request.user_id||sourceMember.status!=="active"||sourceMember.revision!==request.expected_member_revision||destinationMember&&(destinationMember.teamId!==destinationTeam.id||destinationMember.userId!==request.user_id)||Number(destinationMember?.revision??0)!==request.expected_destination_member_revision||before?.user_id!==sourceTeam.managerUserId||after?.user_id!==destinationTeam.managerUserId||!destinationTeam.managerUserId)return unavailable();
 return {ok:true,data:{sourceTeam,destinationTeam,sourceMember,destinationMember,managerBefore:sourceTeam.managerUserId,managerAfter:destinationTeam.managerUserId}};
}

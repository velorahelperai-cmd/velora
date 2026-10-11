"use server";
import {readSessionIdentity} from "@/lib/auth/server-identity";
import {createClient} from "@/lib/supabase/server";
import {teamUuid,parseTeamMutation,parseTeamDirectory,decodeTeamSelf,decodeTeamDirectory,decodeTeamMutation,decodeTransferPreview,type TeamFailure,type TeamResult,type TeamSelf,type TeamDirectory,type TeamMutation,type TransferPreview} from "./contracts";
type Rpc={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
async function gate(expectedUserId:string):Promise<TeamFailure|null>{
 try{
  const current=await readSessionIdentity();if(!current.ok)return {ok:false,code:current.code==="UNAVAILABLE"?"UNAVAILABLE":"UNAUTHENTICATED"};
  if(current.userId!==expectedUserId)return {ok:false,code:"UNAUTHENTICATED"};
  if(!current.emailConfirmed)return {ok:false,code:"UNVERIFIED"};return null;
 }catch{return {ok:false,code:"UNAVAILABLE"};}
}
async function call<T extends object>(expectedUserId:string,name:string,args:Record<string,unknown>,decode:(v:unknown)=>TeamResult<T>,confirmedMutation=false):Promise<TeamResult<T>>{
 const denied=await gate(expectedUserId);if(denied)return denied;
 try{
  // No service client: the database validates its current session/role/row scope again.
  const client=await createClient() as unknown as Rpc;const {data,error}=await client.rpc(name,args);
  if(error)return {ok:false,code:"UNAVAILABLE"};const result=decode(data);if(!result.ok)return result;
  if(confirmedMutation){
   // A committed receipt is tied to the originating actor; it grants no current access.
   let accessNeedsRecheck=true;
   try{
    const current=await readSessionIdentity();
    if(current.ok&&current.userId!==expectedUserId)return {ok:false,code:"UNAUTHENTICATED"};
    accessNeedsRecheck=!current.ok||!current.emailConfirmed;
   }catch{/* Preserve the confirmed receipt when the optional identity read is unavailable. */}
   return {ok:true,data:{...result.data,actorUserId:expectedUserId,accessNeedsRecheck}};
  }
  const changed=await gate(expectedUserId);if(changed)return changed;
  return result;
 }catch{return {ok:false,code:"UNAVAILABLE"};}
}
export async function readPlatformTeamSelf(expectedUserId:string):Promise<TeamResult<TeamSelf>>{
 if(!teamUuid(expectedUserId))return {ok:false,code:"INVALID_INPUT"};const actor=expectedUserId.toLowerCase();
 return call(actor,"platform_team_read_self",{},v=>decodeTeamSelf(v,actor));
}
export async function readPlatformTeamDirectory(input:unknown):Promise<TeamResult<TeamDirectory>>{
 const request=parseTeamDirectory(input);if(!request)return {ok:false,code:"INVALID_INPUT"};
 const cursor=request.cursor;
 return call(request.expectedUserId,"platform_team_read_directory",{p_team_id:request.teamId,p_after_id:cursor?.id??null,p_after_revision:cursor?.revision??null,p_page_size:request.pageSize,p_search:request.search,p_cursor_context:cursor?{actor_user_id:cursor.actorUserId,team_id:cursor.teamId,search:cursor.search,scope_revision:cursor.scopeRevision}:null},v=>decodeTeamDirectory(v,request));
}
export async function mutatePlatformTeam(input:unknown):Promise<TeamResult<TeamMutation>>{
 const request=parseTeamMutation(input);if(!request)return {ok:false,code:"INVALID_INPUT"};
 return call(request.expectedUserId,"platform_team_mutate",{p_input:request.payload},v=>decodeTeamMutation(v,request.payload),true);
}
export async function previewPlatformTeamTransfer(input:unknown):Promise<TeamResult<TransferPreview>>{
 const request=parseTeamMutation(input);if(!request||request.payload.op!=="transfer")return {ok:false,code:"INVALID_INPUT"};
 return call(request.expectedUserId,"platform_team_preview_transfer",{p_input:request.payload},v=>decodeTransferPreview(v,request.payload));
}

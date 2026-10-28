"use server";
import {createHash,randomBytes} from "node:crypto";
import {readSessionIdentity} from "@/lib/auth/server-identity";
import {createClient} from "@/lib/supabase/server";
import {siteUrl} from "@/lib/auth/site-url";
import type {BranchTeamSnapshot,TeamScope} from "@/components/app/paid-team-invitations";
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const valid=(s:TeamScope)=>!!s&&uuid(s.expectedAccountId)&&uuid(s.companyId)&&uuid(s.branchId);
const same=(a:TeamScope,b:TeamScope)=>a?.expectedAccountId===b.expectedAccountId&&a?.companyId===b.companyId&&a?.branchId===b.branchId;
function snapshot(value:unknown,scope:TeamScope):BranchTeamSnapshot|null{
 const s=value as BranchTeamSnapshot|null;
 if(!s||!same(s.scope,scope)||s.version!==1||typeof s.branchLabel!=='string'||![2,4].includes(s.seats?.limit as number)||!Number.isSafeInteger(s.seats.available)||s.seats.available===null||s.seats.available<0||s.seats.available>s.seats.limit!||(s.canReplace!==undefined&&typeof s.canReplace!=='boolean')||(s.canRevoke!==undefined&&typeof s.canRevoke!=='boolean')||typeof s.canInvite!=='boolean'||s.canSkip!==false||s.skip!=='not_skipped'||!uuid(s.createOperationId)||s.skipOperationId!==null||!Array.isArray(s.allowedRoles)||s.allowedRoles.length!==1||s.allowedRoles[0]!=='staff'||!Array.isArray(s.invitations))return null;
 for(const row of s.invitations){const i=row?.invitation;if(!same(row?.scope,scope)||!i||!uuid(i.id)||typeof i.name!=='string'||typeof i.email!=='string'||!['invited','expired','accepted','cancelled','conflicted'].includes(i.status)||!Number.isFinite(Date.parse(i.expiresAt))||!Number.isSafeInteger(i.revision)||i.revision<1)return null;}
 return {scope:{...scope},version:s.version,branchLabel:s.branchLabel,seats:{limit:s.seats.limit,available:s.seats.available},allowedRoles:["staff"],canInvite:s.canInvite,canReplace:s.canReplace===true,canRevoke:s.canRevoke===true,canSkip:false,skip:"not_skipped",createOperationId:s.createOperationId,skipOperationId:null,invitations:s.invitations.map(({invitation:i})=>({scope:{...scope},invitation:{id:i.id,name:i.name,email:i.email,status:i.status,expiresAt:i.expiresAt,revision:i.revision}}))};
}
async function authorized(scope:TeamScope){if(!valid(scope))return false;const identity=await readSessionIdentity();return identity.ok&&identity.userId===scope.expectedAccountId;}
async function call(name:string,args:Record<string,unknown>){const client=await createClient();return client.rpc(name as never,args as never);}
const args=(s:TeamScope)=>({p_expected_account_id:s.expectedAccountId,p_company_id:s.companyId,p_branch_id:s.branchId});
export async function readOwnedBranchTeamAction(scope:TeamScope):Promise<BranchTeamSnapshot|null>{
 try{if(!await authorized(scope))return null;const r=await call('es02_read_owned_branch_team',args(scope));const data=r.data as {ok?:boolean;snapshot?:unknown}|null;return !r.error&&data?.ok===true?snapshot(data.snapshot,scope):null;}catch{return null;}
}
export type TeamInvitationInput=TeamScope&{expectedVersion:number;operationId:string;name:string;email:string;role:'staff';capabilities:string[]};
export type TeamInvitationResult={ok:true;data:{snapshot:BranchTeamSnapshot;inviteUrl:string|null;delivery:'link_only'}}|{ok:false;code:string};
export async function inviteOwnedBranchTeamAction(input:TeamInvitationInput):Promise<TeamInvitationResult>{
 try{
 if(!valid(input)||input.expectedVersion!==1||!uuid(input.operationId)||input.role!=='staff'||typeof input.name!=='string'||input.name.trim().length<2||input.name.trim().length>120||typeof input.email!=='string'||input.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())||!Array.isArray(input.capabilities)||!input.capabilities.length||input.capabilities.length>2||!input.capabilities.every(c=>['wa.conversations.read','ig.conversations.read'].includes(c)))return {ok:false,code:'INVALID_INPUT'};
 if(!await authorized(input))return {ok:false,code:'UNAUTHENTICATED'};
 const token=randomBytes(32).toString('base64url');
 const r=await call('es02_invite_owned_branch_team',{...args(input),p_expected_version:input.expectedVersion,p_operation_id:input.operationId,p_name:input.name.trim(),p_email:input.email.trim().toLowerCase(),p_capabilities:[...new Set(input.capabilities)].sort(),p_token_hash:createHash('sha256').update(token).digest('hex')});
 const data=r.data as {ok?:boolean;code?:string;snapshot?:unknown;tokenMatched?:boolean;replayed?:boolean}|null;
 if(r.error||!data)return {ok:false,code:'UNKNOWN'};
 if(data.ok!==true)return {ok:false,code:typeof data.code==='string'?data.code:'UNKNOWN'};
 const s=snapshot(data.snapshot,input);if(!s||typeof data.tokenMatched!=='boolean'||typeof data.replayed!=='boolean')return {ok:false,code:'UNKNOWN'};
 return {ok:true,data:{snapshot:s,inviteUrl:data.tokenMatched&&!data.replayed?`${siteUrl()}/accept-invite?token=${encodeURIComponent(token)}`:null,delivery:'link_only'}};
 }catch{return {ok:false,code:'UNKNOWN'};}
}

export type TeamRevokeInput=TeamScope&{invitationId:string;expectedRevision:number};
export async function revokeOwnedBranchTeamAction(input:TeamRevokeInput):Promise<{ok:true;snapshot:BranchTeamSnapshot}|{ok:false;code:string}>{
 try{
  if(!valid(input)||!uuid(input.invitationId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)return {ok:false,code:'INVALID_INPUT'};
  if(!await authorized(input))return {ok:false,code:'UNAUTHENTICATED'};
  const r=await call('es02_revoke_owned_branch_team',{...args(input),p_invitation_id:input.invitationId,p_expected_revision:input.expectedRevision});
  const data=r.data as {ok?:boolean;code?:string;snapshot?:unknown}|null;
  if(r.error||!data)return {ok:false,code:'UNKNOWN'};
  if(data.ok!==true)return {ok:false,code:typeof data.code==='string'?data.code:'UNKNOWN'};
  const next=snapshot(data.snapshot,input);
  return next?{ok:true,snapshot:next}:{ok:false,code:'UNKNOWN'};
 }catch{return {ok:false,code:'UNKNOWN'};}
}

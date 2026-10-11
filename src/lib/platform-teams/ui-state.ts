import {parseTeamDirectory, parseTeamMutation, teamUuid, type Team, type TeamCursor, type TeamDirectory, type TeamFailure, type TeamMember, type TeamMutation, type TeamResult, type TransferPreview} from "./contracts";

export const TEAM_JOURNAL_KEY = "velora.internal-team.operation.v1";
export type TeamInput = Record<string, unknown> & {expectedUserId:string;operationId:string;op:string;reason:string};
export type TeamScope = {teamId:string|null;search:string;cursor?:TeamCursor|null};
export type TeamUiApi = {
 readDirectory:(input:unknown)=>Promise<TeamResult<TeamDirectory>>;
 preview:(input:unknown)=>Promise<TeamResult<TransferPreview>>;
 mutate:(input:unknown)=>Promise<TeamResult<TeamMutation>>;
};
export type TeamStorage = Pick<Storage,"getItem"|"setItem"|"removeItem">;
/** Only a server-verified, known actor change discards another actor's retry intent. */
export function discardForeignTeamJournal(storage:TeamStorage,actorId:string){
 try{readJournal(storage,actorId.toLowerCase());}catch{/* Storage unavailable: no transport or authority follows from this cache. */}
}
type Journal = {version:1;actorId:string;phase:"pending";request:TeamInput}|{version:1;actorId:string;phase:"confirmed";operationId:string};
export type TeamUiState = {
 contextKey:string|null;
 scope:TeamScope;directory:TeamResult<TeamDirectory>|null;loading:boolean;preparing:boolean;writing:boolean;
 review:TeamInput|null;preview:TransferPreview|null;uncertain:boolean;confirmed:boolean;
 error:TeamFailure["code"]|"RETRY_STORAGE"|null;
};
const empty = ():TeamUiState => ({contextKey:null,scope:{teamId:null,search:""},directory:null,loading:false,preparing:false,writing:false,review:null,preview:null,uncertain:false,confirmed:false,error:null});
function validInput(value:unknown,actorId:string):TeamInput|null {
 const parsed=parseTeamMutation(value);if(!parsed||parsed.expectedUserId!==actorId)return null;
 const input:TeamInput={...(value as TeamInput),expectedUserId:actorId,operationId:parsed.payload.operation_id,reason:parsed.payload.reason};
 for(const key of ["name","specialty"])if(typeof input[key]==="string")input[key]=(input[key]as string).trim();
 for(const key of ["teamId","userId","managerUserId","sourceTeamId","destinationTeamId"])if(typeof input[key]==="string")input[key]=(input[key]as string).toLowerCase();
 return Object.freeze(input);
}
function readJournal(storage:TeamStorage,actorId:string):Journal|null {
 const text=storage.getItem(TEAM_JOURNAL_KEY);if(!text)return null;
 try{
  if(text.length>4096)throw Error("oversized");
  const row:unknown=JSON.parse(text);
  if(!row||typeof row!=="object"||Array.isArray(row))throw Error("invalid");
  const r=row as Record<string,unknown>;
  if(r.version!==1||r.actorId!==actorId)throw Error("actor/version");
  const keys=r.phase==="pending"?["version","actorId","phase","request"]:["version","actorId","phase","operationId"];
  if(Object.keys(r).some(k=>!keys.includes(k)))throw Error("extra fields");
  if(r.phase==="pending"){
   const request=validInput(r.request,actorId);if(!request)throw Error("invalid request");
   return {version:1,actorId,phase:"pending",request};
  }
  if(r.phase==="confirmed"&&teamUuid(r.operationId))return {version:1,actorId,phase:"confirmed",operationId:r.operationId.toLowerCase()};
  throw Error("invalid phase");
 }catch{storage.removeItem(TEAM_JOURNAL_KEY);return null;}
}

/** Actual component paths share this small store; transport is the existing R3 actions. */
export function createTeamUiStore(options:{actorId:string;api:TeamUiApi;storage:()=>TeamStorage;isCurrentActor:()=>boolean;canWrite:()=>boolean}) {
 const actorId=options.actorId.toLowerCase();let state=empty(),active=false,readGen=0,reviewGen=0,actorGen=0,pending:TeamInput|null=null;
 let actorGuard=options.isCurrentActor,writeGuard=options.canWrite;
 const listeners=new Set<()=>void>();
 const drafts=new Map<string,unknown>();
 const current=()=>active&&actorGuard();
 const update=(patch:Partial<TeamUiState>)=>{state={...state,...patch};listeners.forEach(fn=>fn());};
 const clearJournal=()=>{try{options.storage().removeItem(TEAM_JOURNAL_KEY);}catch{/* A known terminal outcome never becomes an uncertain write. */}};
 function invalidateReview(){reviewGen++;update({review:null,preview:null,preparing:false});}
 function rejectRead(code:TeamFailure["code"]){
  if(!current())return;readGen++;invalidateReview();
  if(["FORBIDDEN","UNAUTHENTICATED","UNVERIFIED"].includes(code))drafts.clear();
  update({directory:null,error:code,loading:false});
 }
 function activate(){
  active=true;
  try{
   const journal=readJournal(options.storage(),actorId);
   pending=journal?.phase==="pending"?journal.request:null;
   update({uncertain:pending!==null,confirmed:journal?.phase==="confirmed",review:null,preview:null,error:null});
  }catch{pending=null;update({error:"RETRY_STORAGE",uncertain:false});}
 }
 function suspend(){active=false;actorGen++;readGen++;reviewGen++;pending=null;drafts.clear();state={...empty(),contextKey:state.contextKey};listeners.forEach(fn=>fn());}
 async function load(scope:TeamScope):Promise<boolean>{
  if(!current())return false;
  const request=parseTeamDirectory({expectedUserId:actorId,teamId:scope.teamId,search:scope.search,cursor:scope.cursor??null,pageSize:25})
   ??parseTeamDirectory({expectedUserId:actorId,teamId:scope.teamId,search:scope.search,cursor:null,pageSize:25});
  if(!request){update({error:"INVALID_INPUT",directory:null,loading:false});return false;}
  const gen=++readGen;invalidateReview();update({scope:{teamId:request.teamId,search:request.search,cursor:request.cursor},directory:null,loading:true});
  let result:TeamResult<TeamDirectory>;try{result=await options.api.readDirectory(request);}catch{result={ok:false,code:"UNAVAILABLE"};}
  if(!current()||gen!==readGen)return false;
  if(!result.ok&&["FORBIDDEN","UNAUTHENTICATED","UNVERIFIED"].includes(result.code))drafts.clear();
  update({directory:result,loading:false,...(result.ok&&!pending?{error:null}:{})});
  if(result.ok&&state.confirmed)clearJournal();
  return result.ok;
 }
 async function review(value:unknown):Promise<void>{
  if(!current()||state.writing)return;
  if(!writeGuard()){update({error:"FORBIDDEN",directory:null});return;}
  if(pending){update({review:null,preview:null,uncertain:true});return;}
  const input=validInput(value,actorId);if(!input){update({error:"INVALID_INPUT"});return;}
  const gen=++reviewGen;update({review:null,preview:null,preparing:true,error:null,confirmed:false});
  if(input.op!=="transfer"){update({review:input,preparing:false});return;}
  let result:TeamResult<TransferPreview>;try{result=await options.api.preview(input);}catch{result={ok:false,code:"UNAVAILABLE"};}
  if(!current()||gen!==reviewGen)return;
  if(result.ok)update({review:input,preview:result.data,preparing:false});
  else rejectRead(result.code);
 }
 async function send(input:TeamInput):Promise<void>{
  if(!current()||state.writing)return;
  if(!writeGuard()){update({error:"FORBIDDEN",directory:null});return;}
  try{options.storage().setItem(TEAM_JOURNAL_KEY,JSON.stringify({version:1,actorId,phase:"pending",request:input} satisfies Journal));}
  catch{update({error:"RETRY_STORAGE"});return;}
  const epoch=actorGen;pending=input;readGen++;update({writing:true,error:null,review:null,preview:null,directory:null,loading:false});
  let result:TeamResult<TeamMutation>;try{result=await options.api.mutate(input);}catch{result={ok:false,code:"UNAVAILABLE"};}
  if(!current()||epoch!==actorGen)return;
  if(result.ok){
   readGen++;
   // Do not patch protected rows from a receipt. Always read current scope again.
   if(result.data.actorUserId!==actorId||result.data.operationId!==input.operationId){update({writing:false,uncertain:true,error:"UNAVAILABLE"});return;}
   pending=null;
   drafts.clear();
   try{options.storage().setItem(TEAM_JOURNAL_KEY,JSON.stringify({version:1,actorId,phase:"confirmed",operationId:input.operationId} satisfies Journal));}catch{/* Pending journal still replays idempotently after a reload. */}
   update({writing:false,confirmed:true,uncertain:false,error:null,directory:null,loading:false});
   await load({...state.scope,cursor:null});return;
  }
  if(["UNAVAILABLE","UNAUTHENTICATED","UNVERIFIED","FORBIDDEN","OPERATION_CONFLICT"].includes(result.code)){
   readGen++;update({writing:false,uncertain:true,error:result.code,directory:null,loading:false});return;
  }
  pending=null;readGen++;clearJournal();update({writing:false,uncertain:false,error:result.code,review:null,preview:null,directory:null,loading:false});
 }
 async function commit(){if(state.review&&!state.writing)await send(state.review);}
 async function retry(){if(pending&&!state.writing)await send(pending);}
 return {getSnapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},readDraft:(key:string)=>drafts.get(key),saveDraft:(key:string,value:unknown)=>{if(current()&&writeGuard())drafts.set(key,value);},rejectRead,bindAuthority:(actor:()=>boolean,write:()=>boolean,contextKey:string|null=null)=>{actorGuard=actor;writeGuard=write;if(contextKey!==state.contextKey){suspend();update({contextKey});}},activate,suspend,load,review,commit,retry,invalidateReview,isCurrent:current};
}
export type TeamUiStore=ReturnType<typeof createTeamUiStore>;

/** Never treat a missing filtered/current-page row as an absent membership. */
export async function readTeamMemberRevision(options:{actorId:string;teamId:string;userId:string;readDirectory:TeamUiApi["readDirectory"];isCurrent:()=>boolean}):Promise<TeamResult<{team:Team;member:TeamMember|null}>> {
 if(!teamUuid(options.actorId)||!teamUuid(options.teamId)||!teamUuid(options.userId))return {ok:false,code:"INVALID_INPUT"};
 let cursor:TeamCursor|null=null,captured:Team|null=null;const seen=new Set<string>();
 do{
  if(!options.isCurrent())return {ok:false,code:"UNAUTHENTICATED"};
  let result:TeamResult<TeamDirectory>;
  try{result=await options.readDirectory({expectedUserId:options.actorId,teamId:options.teamId,search:"",pageSize:100,cursor});}catch{return {ok:false,code:"UNAVAILABLE"};}
  if(!options.isCurrent())return {ok:false,code:"UNAUTHENTICATED"};
  if(!result.ok)return result;
  const {team,rows,nextCursor}=result.data;
  if(result.data.kind!=="members"||!team||team.id!==options.teamId)return {ok:false,code:"UNAVAILABLE"};
  if(captured&&captured.revision!==team.revision)return {ok:false,code:"CONFLICT"};captured=team;
  const member=rows.find(row=>"userId"in row&&row.userId===options.userId)as TeamMember|undefined;
  if(member)return {ok:true,data:{team,member}};
  cursor=nextCursor;
  if(cursor){if(seen.has(cursor.id))return {ok:false,code:"UNAVAILABLE"};seen.add(cursor.id);}
 }while(cursor);
 return captured?{ok:true,data:{team:captured,member:null}}:{ok:false,code:"UNAVAILABLE"};
}

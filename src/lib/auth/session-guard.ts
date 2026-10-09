import { sessionGuardFromRpc, type SessionGuard } from "./idle-session";
/** Database uses auth.uid()/session_id and its own clock; client timestamps are never accepted. */
export async function checkAppSession(client:{rpc:unknown},touch=false):Promise<SessionGuard>{
 try{const rpc=client.rpc as unknown as (name:string,args:{p_touch:boolean})=>PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>;const {data,error}=await rpc.call(client,"check_app_session",{p_touch:touch});return sessionGuardFromRpc(data,error);}catch{return {ok:false,code:"UNAVAILABLE"};}
}


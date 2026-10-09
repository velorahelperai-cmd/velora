export const IDLE_TIMEOUT_MS=2*60*60*1000;
export type SessionGuard={ok:true;expiresAt:string}|{ok:false;code:"UNAUTHENTICATED"|"UNAVAILABLE";expired?:true};
export function isSessionIdleExpired(lastActivity:number,now:number):boolean{return !Number.isFinite(lastActivity)||!Number.isFinite(now)||lastActivity>now||now-lastActivity>=IDLE_TIMEOUT_MS;}
export function sessionGuardFromRpc(data:unknown,error:{code?:string;message?:string}|null):SessionGuard{
 if(error){
  const expired=error.code==="42501"&&error.message?.includes("APP_SESSION_EXPIRED")
   ||(error.code==="PGRST301"||error.code==="PGRST303")&&/\bJWT (?:has )?expired\b/i.test(error.message??"");
  return expired?{ok:false,code:"UNAUTHENTICATED",expired:true}:{ok:false,code:"UNAVAILABLE"};
 }
 if(!data||typeof data!=="object"||Array.isArray(data))return {ok:false,code:"UNAVAILABLE"};
 const row=data as Record<string,unknown>;
 if(row.ok===false)return row.code==="SESSION_EXPIRED"?{ok:false,code:"UNAUTHENTICATED",expired:true}:{ok:false,code:row.code==="UNAUTHENTICATED"?"UNAUTHENTICATED":"UNAVAILABLE"};
 if(row.ok!==true||typeof row.expires_at!=="string"||Number.isNaN(Date.parse(row.expires_at)))return {ok:false,code:"UNAVAILABLE"};
 return {ok:true,expiresAt:row.expires_at};
}


"use server";
import { createClient } from "@/lib/supabase/server";
import { checkAppSession } from "./session-guard";
import type { SessionGuard } from "./idle-session";
/** Only real UI activity calls touch=true. Profile loads, polling and token refresh do not. */
export async function checkSessionActivity(touch=false):Promise<SessionGuard>{
 try{
  const client=await createClient();
  const {data,error}=await client.auth.getUser();
  if(error||!data.user){
   const isMissing=error?.name==="AuthSessionMissingError"||(!error&&!data?.user);
   return {ok:false as const,code:isMissing?"UNAUTHENTICATED" as const:"UNAVAILABLE" as const,confirmed:isMissing};
  }
  const guard=await checkAppSession(client,touch===true);
  if(!guard.ok){
   return {...guard,confirmed:guard.code==="UNAUTHENTICATED"};
  }
  return guard;
 }catch{
  return {ok:false as const,code:"UNAVAILABLE" as const,confirmed:false};
 }
}

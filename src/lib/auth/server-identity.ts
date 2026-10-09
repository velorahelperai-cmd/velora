import { createClient } from "@/lib/supabase/server";
import { checkAppSession } from "./session-guard";
export async function readSessionIdentity(){
 try{
 const client=await createClient();
 const {data,error}=await client.auth.getUser();
 if(error)return {ok:false as const,code:error.name==="AuthSessionMissingError"?"UNAUTHENTICATED" as const:"UNAVAILABLE" as const};
 if(!data.user)return {ok:false as const,code:"UNAUTHENTICATED" as const};
 const guard=await checkAppSession(client);
 if(!guard.ok)return guard;
 return {ok:true as const,userId:data.user.id,email:data.user.email??"",fullName:String(data.user.user_metadata?.full_name||data.user.user_metadata?.name||""),emailConfirmed:!!(data.user.email_confirmed_at||data.user.phone_confirmed_at),sessionExpiresAt:guard.expiresAt};
 }catch{return {ok:false as const,code:"UNAVAILABLE" as const};}
}

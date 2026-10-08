"use server";
import { createClient } from "@/lib/supabase/server";
import { checkAppSession } from "./session-guard";
/** Only real UI activity calls touch=true. Profile loads, polling and token refresh do not. */
export async function checkSessionActivity(touch=false){try{const client=await createClient();const {data,error}=await client.auth.getUser();if(error||!data.user)return {ok:false as const,code:error&&error.name!=="AuthSessionMissingError"?"UNAVAILABLE" as const:"UNAUTHENTICATED" as const};return await checkAppSession(client,touch===true);}catch{return {ok:false as const,code:"UNAVAILABLE" as const};}}

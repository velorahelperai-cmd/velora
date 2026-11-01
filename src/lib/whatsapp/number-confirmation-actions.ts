"use server";
import {revalidatePath} from "next/cache";
import {getCompanyAccess} from "@/lib/tenancy/access";
import {createClient} from "@/lib/supabase/server";
import {checkAppSession} from "@/lib/auth/session-guard";
import {authorizeCoexistenceOwner,type OwnerRpcClient} from "./coexistence/owner-auth";
import {readNumberConfirmationStore,decideNumberConfirmationStore,type NumberConfirmationRead,type NumberConfirmationDecision} from "./number-confirmation-store";

async function owner(companyId:string){
 return authorizeCoexistenceOwner(companyId,{
  access:()=>getCompanyAccess("owner"),
  session:async()=>{const client=await createClient(),claims=await client.auth.getClaims();return {client:client as unknown as OwnerRpcClient,subject:claims.data?.claims?.sub,sessionId:claims.data?.claims?.session_id,claimsError:Boolean(claims.error)};},
  checkSession:client=>checkAppSession(client),
 });
}
export async function readNumberConfirmationAction(companyId:string):Promise<NumberConfirmationRead>{
 const auth=await owner(companyId);if(!auth.ok)return {ok:false,code:auth.code};
 return readNumberConfirmationStore(auth.client,auth.identity.companyId);
}
/** "Not my number" disconnects through the existing database disconnect paths; the decision is audited server-side. */
export async function decideNumberConfirmationAction(input:{companyId:string;linkId:string;linkGeneration:number;answer:"confirmed"|"rejected"}):Promise<NumberConfirmationDecision>{
 const auth=await owner(input?.companyId);if(!auth.ok)return {ok:false,code:auth.code};
 const result=await decideNumberConfirmationStore(auth.client,{...input,companyId:auth.identity.companyId});
 if(result.ok){revalidatePath("/setup");revalidatePath("/app/settings");}
 return result;
}

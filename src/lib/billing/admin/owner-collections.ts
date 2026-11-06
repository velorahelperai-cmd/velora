import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import {readFinancialCollections} from "../financial-read";
import {billingOwnerGate,recheckBillingOwner} from "./owner-gate";
export async function readOwnerCollections(){
 const owner=await billingOwnerGate();if(!owner.ok)return owner;const admin=createAdminClient();if(!admin)return {ok:false as const,code:"unavailable" as const};
 try{const data=await readFinancialCollections(admin);const recheck=await recheckBillingOwner(owner.binding);if(!recheck.ok)return recheck;return {ok:true as const,data,binding:owner.binding};}catch{return {ok:false as const,code:"unavailable" as const};}
}

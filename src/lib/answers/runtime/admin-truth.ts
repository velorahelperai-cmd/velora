"use server";
import {readAdminAIState} from "./admin-actions";
import type {AdminAIState} from "./admin-types";
import type {FinancialCollections} from "@/lib/billing/financial-read";
import {readOwnerCollections} from "@/lib/billing/admin/owner-collections";
import {recheckBillingOwner} from "@/lib/billing/admin/owner-gate";
export type AdminTruth={ai:AdminAIState|null;collections:FinancialCollections};
export async function readAdminTruth(){
 const financial=await readOwnerCollections();if(!financial.ok)return {ok:false as const,error:financial.code};
 let ai:AdminAIState|null=null;try{const result=await readAdminAIState();if(result.ok)ai=result.data;}catch{/* Financial evidence remains independently available. */}
 if(!await recheckBillingOwner(financial.binding))return {ok:false as const,error:"OWNER_REQUIRED"};
 return {ok:true as const,data:{ai,collections:financial.data}};
}

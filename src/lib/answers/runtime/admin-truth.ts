/** Separate synthetic owner test action. Confirmation remains off unless supplied explicitly. */
"use server";
import {readAdminAIState} from "./admin-actions";
import type {AdminAIState} from "./admin-types";
import type {FinancialCollections} from "@/lib/billing/financial-read";
import {readOwnerCollections} from "@/lib/billing/admin/owner-collections";
import {recheckBillingOwner} from "@/lib/billing/admin/owner-gate";
export type AdminTruth={ai:AdminAIState|null;collections:FinancialCollections};
export async function readAdminTruth(){
 // Independent reads retain independent authorization, plus the final binding recheck.
 const [financial,ai]=await Promise.all([
  readOwnerCollections(),
  readAdminAIState().then(result=>result.ok?result.data:null).catch(()=>null),
 ]);
 if(!financial.ok)return {ok:false as const,error:financial.code};
 if(!await recheckBillingOwner(financial.binding))return {ok:false as const,error:"OWNER_REQUIRED"};
 return {ok:true as const,data:{ai,collections:financial.data}};
}

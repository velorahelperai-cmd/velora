"use server";
import {createAdminClient} from "@/lib/supabase/admin";
import {readAdminAIState} from "./admin-actions";
import type {AdminAIState} from "./admin-types";
import {readFinancialCollections,type FinancialCollections} from "@/lib/billing/financial-read";
export type AdminTruth={ai:AdminAIState;collections:FinancialCollections};
export async function readAdminTruth(){
 const ai=await readAdminAIState();if(!ai.ok)return ai;
 const client=createAdminClient();if(!client)return {ok:false as const,error:"DATABASE_UNAVAILABLE"};
 try {
  const collections=await readFinancialCollections(client);
  return {ok:true as const,data:{ai:ai.data,collections}};
 } catch {return {ok:false as const,error:"FINANCIAL_DATABASE_UNAVAILABLE"};}
}

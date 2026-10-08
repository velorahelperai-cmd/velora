"use server";
import {createAdminClient} from "@/lib/supabase/admin";
import {readAdminAIState} from "./admin-actions";
import type {AdminAIState} from "./admin-types";
export type AdminTruth={ai:AdminAIState;collections:{live_collected_baisa:number;test_collected_baisa:number;settled_orders:number}};
export async function readAdminTruth(){
 const ai=await readAdminAIState();if(!ai.ok)return ai;
 const client=createAdminClient();if(!client)return {ok:false as const,error:"DATABASE_UNAVAILABLE"};
 const rpc=client.rpc as unknown as (name:string)=>PromiseLike<{data:unknown;error:unknown}>;
 const result=await rpc.call(client,"admin_financial_summary");
 if(result.error||!result.data||typeof result.data!=="object")return {ok:false as const,error:"FINANCIAL_DATABASE_UNAVAILABLE"};
 const data=result.data as AdminTruth["collections"];
 if(![data.live_collected_baisa,data.test_collected_baisa,data.settled_orders].every(v=>Number.isFinite(Number(v))&&Number(v)>=0))return {ok:false as const,error:"INVALID_FINANCIAL_DATA"};
 return {ok:true as const,data:{ai:ai.data,collections:data}};
}

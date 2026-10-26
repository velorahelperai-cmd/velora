import "server-only";
import {createClient} from "@/lib/supabase/server";
import {checkAppSession} from "@/lib/auth/session-guard";

import {billingUuid} from "./public-offer-policy";
import {type createAtomicPurchasePersistRpc, type AtomicPurchasePersistResult} from "./purchase-persist-rpc";
/** Verified session claims are read on the server; never accepted in action inputs. */
export async function readBillingActorSession(expectedUserId: string): Promise<string|null> {
 try {
  const client=await createClient(); const {data,error}=await client.auth.getClaims();
  const claims=data?.claims;
  if(error || claims?.sub!==expectedUserId || !billingUuid(claims?.session_id)) return null;
  const session=await checkAppSession(client); return session.ok ? claims.session_id : null;
 }catch{return null;}
}
type PurchaseInput = Parameters<ReturnType<typeof createAtomicPurchasePersistRpc>>[0];
type RpcClient = {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>};
export async function persistPublicTestPurchase(admin:RpcClient,args:PurchaseInput,actorSessionId:string):Promise<AtomicPurchasePersistResult> {
 void admin; void args; void actorSessionId; return {ok:false,code:"provider_retired"};
}

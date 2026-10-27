"use server";
import { createClient } from "@/lib/supabase/server";
import { checkAppSession } from "@/lib/auth/session-guard";
import { es02Uuid } from "@/lib/billing/es02/contracts";
import { classifyProvisionWriteAck } from "@/lib/billing/es02/write-ack";
import { verifyOwnedThawaniTestPayment } from "@/lib/billing/es02/thawani-account-checkout";
import {localLiveReadiness,localLiveRequested} from '@/lib/billing/es02/local-live-policy';

export async function verifyThawaniPayment(orderId: string): Promise<{ ok: true; paid: boolean } | { ok: false }> {
  const live=localLiveRequested(process.env);
  if (!es02Uuid(orderId) || (live?!localLiveReadiness(process.env).configurationReady:process.env.BILLING_ES02_THAWANI_TEST_ENABLED !== "true")) return { ok: false };
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getClaims();
    const accountId = data?.claims?.sub;
    if (error || !es02Uuid(accountId) || accountId !== (live?process.env.VELORA_LOCAL_LIVE_ACCOUNT_ID:process.env.THAWANI_TEST_ACCOUNT_ID)?.trim() || !(await checkAppSession(client)).ok) return { ok: false };
    if(live){const {verifyOwnedThawaniLocalLivePayment}=await import('@/lib/billing/es02/thawani-live-account-checkout');return verifyOwnedThawaniLocalLivePayment(accountId,orderId);}
    return await verifyOwnedThawaniTestPayment(accountId, orderId);
  } catch { return { ok: false }; }
}

export async function finishTestCheckout(orderId: string): Promise<{ ok: true; next: string } | { ok: false }> {

  const live=localLiveRequested(process.env);
  if (!es02Uuid(orderId) || (live?!localLiveReadiness(process.env).configurationReady:process.env.BILLING_ES02_THAWANI_TEST_ENABLED !== "true")) return { ok: false };
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  const accountId = data?.claims?.sub;
  if (error || !es02Uuid(accountId) || accountId !== (live?process.env.VELORA_LOCAL_LIVE_ACCOUNT_ID:process.env.THAWANI_TEST_ACCOUNT_ID)?.trim()) return { ok: false };
  if (!(await checkAppSession(client)).ok) return { ok: false };
  try {
    const result = await client.rpc((live?'es02_finish_thawani_live_checkout':"es02_finish_thawani_test_checkout") as never, { p_expected_account_id: accountId, p_order_id: orderId } as never);
    if (result.error) return { ok: false };
    const ack = classifyProvisionWriteAck(result.data);
    if (ack.status !== "success") return { ok: false };
    const row = ack.data as { orderId?: unknown; companyId?: unknown } | null;
    if (row?.orderId !== orderId || !es02Uuid(row?.companyId)) return { ok: false };
    if(live){
      const {selectWorkspaceCompany}=await import('@/lib/tenancy/actions');
      const selected=await selectWorkspaceCompany(row.companyId,{expectedUserId:accountId,next:'/setup'});
      if(!selected.ok||selected.data?.companyId!==row.companyId)return {ok:false};
    }
    return { ok: true, next: "/setup" };
  } catch { return { ok: false }; }
}

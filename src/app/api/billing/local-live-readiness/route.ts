import {localLiveReadiness} from "@/lib/billing/es02/local-live-policy";

/** Local diagnostics only. No credentials, account identifiers or provider calls. */
export async function GET(request: Request) {
  const readiness = localLiveReadiness(process.env);
  const target = new URL(request.url);
  // Next's internal request URL may use localhost despite a 127.0.0.1 bind.
  const host = request.headers.get("host") ?? target.host;
  if (!readiness.local || host !== "127.0.0.1:3330") {
    return new Response(null, {status:404});
  }
  let nativeReady=false;
  if(readiness.configurationReady){
    try{
      const {createAdminClient}=await import('@/lib/supabase/admin');
      const admin=createAdminClient();
      if(admin){const result=await admin.rpc('es02_thawani_live_readiness' as never,{p_account_id:process.env.VELORA_LOCAL_LIVE_ACCOUNT_ID,p_grant_id:process.env.VELORA_LOCAL_LIVE_GRANT_ID} as never);nativeReady=!result.error&&result.data===true;}
    }catch{/* Missing native authority is a blocker, never a provider success. */}
  }
  return Response.json({
    ...readiness,
    checkoutEnabled:readiness.configurationReady&&nativeReady,
    status:readiness.configurationReady&&nativeReady?'READY_FOR_USER_CHECKOUT':'BLOCKED',
    blockers:[...readiness.blockers,...(nativeReady?[]:['NATIVE_LIVE_PRICE_AND_SETTLEMENT_CONTRACT_REQUIRED'])],
    minimumApprovalDoesNotCreateCheckout:true,
    webhookChanged:false,
  }, {headers:{"Cache-Control":"no-store"}});
}

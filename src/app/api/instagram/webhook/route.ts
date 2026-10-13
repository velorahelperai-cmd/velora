import {createAdminClient} from '@/lib/supabase/admin';
import type {InstagramRpcClient} from '@/lib/instagram/connection-store';
import {createInstagramSignedWebhookPersistence,readInstagramInboundRuntime} from '@/lib/instagram/inbound-producer';
import { createInstagramWebhookHandlers } from "@/lib/instagram/webhook-route";
import {instagramConfig} from '@/lib/instagram/config';
import {instagramWebhookChallenge} from '@/lib/instagram/webhook-challenge';
export const runtime = "nodejs";
/** Internal persistence wiring; installed signing/provider proof remains closed.
 * Environment presence cannot activate receiving or certify timestamp units. */
const handlers = createInstagramWebhookHandlers({
  readReadiness: async () => {
    const readiness=await readInstagramInboundRuntime(process.env,createAdminClient() as unknown as InstagramRpcClient|null);
    return {...readiness,receiveEnabled:instagramConfig().receiveEnabled,verifyToken:readiness.installedSecretVerified?process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN:undefined,parentWebhookSecret:readiness.installedSecretVerified&&process.env.INSTAGRAM_PARENT_WEBHOOK_APP_SECRET
      ?{source:'parent_webhook_app' as const,value:process.env.INSTAGRAM_PARENT_WEBHOOK_APP_SECRET}:undefined};
  },
  persist:async batch=>{
    const readiness=await readInstagramInboundRuntime(process.env,createAdminClient() as unknown as InstagramRpcClient|null);
    if(!readiness.installedSecretVerified||!readiness.providerFixtureVerified)return {status:'retryable'};
    const server=createAdminClient(),value=process.env.INSTAGRAM_PARENT_WEBHOOK_APP_SECRET,app=process.env.INSTAGRAM_PARENT_WEBHOOK_APP_ID;
    if(!server||!value||!app)return {status:'retryable'};
    return createInstagramSignedWebhookPersistence(server as unknown as InstagramRpcClient,{
      parentAppId:app,secret:{source:'parent_webhook_app',value},installedSecretVerified:readiness.installedSecretVerified,
      providerFixtureVerified:readiness.providerFixtureVerified,
    })(batch);
  },
});
export async function GET(request:Request) {
  return instagramWebhookChallenge(request) ?? handlers.GET(request);
}
export const POST = handlers.POST;

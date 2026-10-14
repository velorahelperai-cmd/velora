import {createAdminClient} from '@/lib/supabase/admin';
import type {InstagramRpcClient} from '@/lib/instagram/connection-store';
import {createInstagramSignedWebhookPersistence,readInstagramInboundRuntime} from '@/lib/instagram/inbound-producer';
import { createInstagramWebhookHandlers } from "@/lib/instagram/webhook-route";
import {instagramConfig} from '@/lib/instagram/config';
import {instagramWebhookChallenge} from '@/lib/instagram/webhook-challenge';
import {tryInstagramReviewBootstrap} from '@/lib/instagram/review-bootstrap';
import {createHash} from 'node:crypto';
import {verifyInstagramWebhookSignature} from '@/lib/instagram/webhook-parse';
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
      reviewCompanyId:process.env.INSTAGRAM_REVIEW_ENABLED==='true'?process.env.INSTAGRAM_REVIEW_COMPANY_ID:undefined,
    })(batch);
  },
});
export async function GET(request:Request) {
  return instagramWebhookChallenge(request) ?? handlers.GET(request);
}
export async function POST(request:Request){
 const server=createAdminClient() as unknown as InstagramRpcClient|null,companyId=process.env.INSTAGRAM_REVIEW_COMPANY_ID,parent=process.env.INSTAGRAM_PARENT_WEBHOOK_APP_ID,secret=process.env.INSTAGRAM_PARENT_WEBHOOK_APP_SECRET;
 const fingerprint=secret?createHash('sha256').update(secret).digest('hex'):null;
 const args={p_company_id:companyId,p_parent_app_id:parent,p_secret_fingerprint:fingerprint};
 const observed=await tryInstagramReviewBootstrap(request,{enabled:process.env.INSTAGRAM_REVIEW_ENABLED==='true'&&!!companyId&&!!parent&&!!server,secret:secret??'',
  // Diagnostic comparison only: another credential never authenticates this request.
  onRejected:(code,raw,signature)=>{const loginSecret=process.env.INSTAGRAM_APP_SECRET;console.info('instagram.review_bootstrap',{
   code,instagramLoginSecretMatches:code==='INVALID_SIGNATURE'&&!!loginSecret&&verifyInstagramWebhookSignature(raw,[signature],{source:'parent_webhook_app',value:loginSecret})});},
  readScope:async()=>{const {data,error}=await server!.rpc('instagram_read_review_bootstrap',args);if(error||!data||typeof data!=='object'||Array.isArray(data))throw Error('REVIEW_SCOPE_UNAVAILABLE');
   const r=data as Record<string,unknown>;return r.ok===true&&typeof r.account_id==='string'&&typeof r.nonce_sha256==='string'&&typeof r.expires_at==='string'?{accountId:r.account_id,nonceSha256:r.nonce_sha256,expiresAt:r.expires_at}:null;},
  observe:async batch=>{const {data,error}=await server!.rpc('instagram_observe_review_bootstrap',{...args,p_batch:batch});return {status:!error&&data&&typeof data==='object'&&'status' in data&&data.status==='committed'?'committed':'retryable'};},
 });
 return observed??handlers.POST(request);
}

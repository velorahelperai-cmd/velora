import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {parseReviewGrant} from '@/lib/meta-review/access';
import {boundedReviewMatches,consumeManualReviewPermit,issueManualReviewPermit} from './manual-review-permit';
const id='abcdefab-0000-4000-8000-000000000001';
const message={toWaId:'96890000420',phoneNumberId:'12345',body:'authorized message'};
const binding={...message,conversationId:id,linkId:id,linkGeneration:2};
const raw={id,channel:'whatsapp',app_id:'123',asset_id:'12345',source_account_id:'456',recipient_ids:[message.toWaId],send_limit:1,used_count:0,expires_at:'2099-01-01T00:00:00Z',revoked_at:null,review_conversation_id:id,review_link_id:id,review_link_generation:2,review_body_sha256:createHash('sha256').update(message.body).digest('hex')};
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks();});
it('accepts only complete one-message grants',()=>{
 expect(parseReviewGrant(raw)).not.toBeNull();
 for(const change of [{send_limit:2},{used_count:2},{review_conversation_id:null},{review_link_id:null},{review_link_generation:null},{review_body_sha256:null},{recipient_ids:[message.toWaId,'96890000421']},{channel:'instagram'}])expect(parseReviewGrant({...raw,...change})).toBeNull();
});
it('binds the exact message, conversation, recipient and link generation',()=>{
 const grant=parseReviewGrant(raw)!;expect(boundedReviewMatches(grant,binding)).toBe(true);
 for(const change of [{toWaId:'96890000421'},{body:'other'},{phoneNumberId:'9'},{conversationId:'other'},{linkId:null},{linkGeneration:3}])expect(boundedReviewMatches(grant,{...binding,...change})).toBe(false);
 expect(boundedReviewMatches({...grant,revoked_at:new Date().toISOString()},binding)).toBe(false);
 expect(boundedReviewMatches(grant,binding,Date.parse(raw.expires_at))).toBe(false);
});
it('rejects forged, expired, mismatched and replayed process capabilities',()=>{
 expect(consumeManualReviewPermit({kind:'bounded-manual-review'},message)).toBe(false);
 const deadline=new Date(Date.now()+5000).toISOString();
 const permit=issueManualReviewPermit(message,deadline)!;
 expect(consumeManualReviewPermit(permit,message)).toBe(true);
 expect(consumeManualReviewPermit(permit,message)).toBe(false);
 const wrong=issueManualReviewPermit(message,deadline)!;
 expect(consumeManualReviewPermit(wrong,{...message,body:'different'})).toBe(false);
 expect(consumeManualReviewPermit(wrong,message)).toBe(false);
 expect(issueManualReviewPermit(message,new Date(Date.now()+60000).toISOString())).toBeUndefined();
 vi.useFakeTimers();const short=issueManualReviewPermit(message,new Date(Date.now()+1000).toISOString())!;
 vi.advanceTimersByTime(1001);expect(consumeManualReviewPermit(short,message)).toBe(false);
});
it('permits exactly one provider call while global sending stays disabled',async()=>{
 vi.stubEnv('WHATSAPP_ALLOW_EXTERNAL_SEND','false');vi.stubEnv('WHATSAPP_CONFIGURATION_MODE','live');
 vi.stubEnv('WHATSAPP_ROUTING_MODE','tenant_registry');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION','v26.0');
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({messages:[{id:'wamid.fixture'}]}),{status:200}));
 const {sendWhatsappText}=await import('./send');
 const input={...message,accessToken:'synthetic-token',serviceWindowExpiresAt:new Date(Date.now()+60000).toISOString(),manualReviewPermit:issueManualReviewPermit(message,new Date(Date.now()+5000).toISOString())};
 expect((await sendWhatsappText(input)).ok).toBe(true);
 expect(await sendWhatsappText(input)).toEqual({ok:false,code:'SEND_DISABLED'});expect(fetch).toHaveBeenCalledTimes(1);
});

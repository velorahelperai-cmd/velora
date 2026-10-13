import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {instagramWebhookChallenge as challenge} from './webhook-challenge';
const now=Date.parse('2026-10-13T04:00:00Z');
const scope={parentAppId:'3391832644330595',secretSha256:createHash('sha256').update('synthetic-parent-secret').digest('hex'),validFrom:'2026-10-13T03:00:00Z',expiresAt:'2026-10-15T03:00:00Z'};
const env={INSTAGRAM_WEBHOOK_CHALLENGE_ENABLED:'true',INSTAGRAM_WEBHOOK_CHALLENGE_SCOPE:JSON.stringify(scope),INSTAGRAM_PARENT_WEBHOOK_APP_ID:scope.parentAppId,INSTAGRAM_PARENT_WEBHOOK_APP_SECRET:'synthetic-parent-secret',INSTAGRAM_WEBHOOK_VERIFY_TOKEN:'synthetic-token',INSTAGRAM_RECEIVE_ENABLED:'false'};
const request=new Request('https://example.test/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=synthetic-token&hub.challenge=123');
describe('isolated initial webhook challenge',()=>{
 it('answers with organic receive disabled',async()=>{const r=challenge(request,env,now)!;expect(r.status).toBe(200);expect(await r.text()).toBe('123');});
 it('is closed by default',()=>expect(challenge(request,{},now)).toBeNull());
 it.each([{INSTAGRAM_PARENT_WEBHOOK_APP_ID:'1130181646406297'},{INSTAGRAM_PARENT_WEBHOOK_APP_SECRET:'wrong'},{INSTAGRAM_WEBHOOK_VERIFY_TOKEN:''},{INSTAGRAM_WEBHOOK_CHALLENGE_SCOPE:'{}'}])('rejects missing or mismatched installation',patch=>expect(challenge(request,{...env,...patch},now)!.status).toBe(503));
 it('expires without fallback',()=>expect(challenge(request,env,Date.parse(scope.expiresAt))!.status).toBe(503));
 it('rejects excess duration',()=>expect(challenge(request,{...env,INSTAGRAM_WEBHOOK_CHALLENGE_SCOPE:JSON.stringify({...scope,expiresAt:'2026-10-16T03:00:00Z'})},now)!.status).toBe(503));
 it('rejects duplicate parameters',()=>expect(challenge(new Request(request.url+'&hub.challenge=456'),env,now)!.status).toBe(403));
 it('cannot accept an event POST',()=>expect(challenge(new Request(request.url,{method:'POST'}),env,now)!.status).toBe(403));
});

import {createHash,createHmac} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {tryInstagramReviewBootstrap} from './review-bootstrap';
const nonce='VELORA-REVIEW-offline-proof',secret='synthetic-parent-secret',accountId='17841416239520365';
function fixture(text=nonce,sibling=false){const now=Date.now(),messaging=[{sender:{id:'200'},recipient:{id:accountId},timestamp:now-1000,message:{mid:'mid.offline-bootstrap',text}},...(sibling?[{sender:{id:'200'},recipient:{id:accountId},timestamp:now-900,message:{mid:'mid.offline-sibling',text:'second real message'}}]:[])],raw=JSON.stringify({object:'instagram',entry:[{id:accountId,time:now,messaging}]});
 return new Request('https://www.velorahelper.com/api/instagram/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(raw).digest('hex')},body:raw});}
const scope={accountId,nonceSha256:createHash('sha256').update(nonce).digest('hex'),expiresAt:new Date(Date.now()+30*60000).toISOString()};
it('captures only the deliberately challenged and actually signed provider message',async()=>{
 const observe=vi.fn().mockResolvedValue({status:'committed'});
 const response=await tryInstagramReviewBootstrap(fixture(),{enabled:true,secret,readScope:async()=>scope,observe});
 expect(response?.status).toBe(200);expect(observe).toHaveBeenCalledOnce();
 expect(observe.mock.calls[0][0]).toMatchObject({rawBodySha256:expect.stringMatching(/^[a-f0-9]{64}$/),events:[{professionalAccountId:accountId,senderId:'200',rawTimestamp:expect.any(Number)}]});
});
it('persists sibling messages before acknowledging the signed batch',async()=>{
 const observe=vi.fn().mockResolvedValue({status:'committed'});
 expect((await tryInstagramReviewBootstrap(fixture(nonce,true),{enabled:true,secret,readScope:async()=>scope,observe}))?.status).toBe(200);
 expect(observe.mock.calls[0][0].events).toHaveLength(2);
 expect(observe.mock.calls[0][0].events[1].messageId).toBe('mid.offline-sibling');
});
it('does not install authority from an invalid signature or an unrelated message',async()=>{
 const observe=vi.fn();const req=fixture();req.headers.set('x-hub-signature-256','sha256='+'0'.repeat(64));
 for(const request of [req,fixture('unrelated customer message')])expect((await tryInstagramReviewBootstrap(request,{enabled:true,secret,readScope:async()=>scope,observe}))?.status).not.toBe(200);
 expect(observe).not.toHaveBeenCalled();
});
it('falls back to the normal handler without consuming the body when no bootstrap is active',async()=>{
 const request=fixture();expect(await tryInstagramReviewBootstrap(request,{enabled:false,secret,readScope:async()=>scope,observe:vi.fn()})).toBeNull();expect(request.bodyUsed).toBe(false);
});
it('reports the verifier failure without permitting the diagnostic to authenticate',async()=>{
 const req=fixture();req.headers.set('x-hub-signature-256','sha256='+'0'.repeat(64));
 const onRejected=vi.fn(),observe=vi.fn();
 expect((await tryInstagramReviewBootstrap(req,{enabled:true,secret,readScope:async()=>scope,observe,onRejected}))?.status).toBe(401);
 expect(onRejected.mock.calls[0][0]).toBe('INVALID_SIGNATURE');expect(observe).not.toHaveBeenCalled();
});

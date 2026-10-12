import 'server-only';
import type {InstagramSendBinding,InstagramSendPorts,InstagramSendProgress,InstagramSendResultValue,InstagramSendSettlement} from './send-contracts';
import {captureFreshSendClaim,captureSendBinding,captureSendProgress,sendMid} from './send-validation';
type Result=InstagramSendResultValue<InstagramSendProgress>;
const unavailable=():Result=>({ok:false,code:'UNAVAILABLE'});
async function readOnce(b:InstagramSendBinding,p:InstagramSendPorts):Promise<Result>{try{const r=await p.read(b);return r.ok?{ok:true,data:captureSendProgress(r.data,b)}:r;}catch{return unavailable();}}
async function projectAccepted(r:Result,b:InstagramSendBinding,p:InstagramSendPorts):Promise<Result>{
 if(!r.ok||r.data.state!=='accepted')return r;
 try{const repaired=await p.project(b);if(repaired.ok&&repaired.data.state==='accepted')return {ok:true,data:captureSendProgress(repaired.data,b)};}catch{}
 return r; // Persisted provider acceptance survives unavailable timeline repair.
}
/** One committed final gate, then one immediate attempt. This module is server-only
 * and intentionally has no production/action composition while runtime is closed.
 * Authority decisions are pinned during SQL, not atomically across a remote HTTP
 * request; revocation cannot retroactively cancel an already issued network attempt. */
export async function dispatchInstagramIntent(supplied:InstagramSendBinding,p:InstagramSendPorts):Promise<Result>{
 let b:InstagramSendBinding;try{b=captureSendBinding(supplied);if(!p.enabled())return {ok:false,code:'SEND_DISABLED'};}catch{return unavailable();}
 const before=await readOnce(b,p);if(!before.ok||before.data.state!=='ready')return projectAccepted(before,b,p);
 let claim;
 try{claim=await p.claim(b);if('ok' in claim)return claim;if(claim.kind==='existing')return projectAccepted({ok:true,data:captureSendProgress(claim.progress,b)},b,p);claim=captureFreshSendClaim(claim,b);}catch{return projectAccepted(await readOnce(b,p),b,p);}
 let outcome:InstagramSendSettlement;
 try{
  const now=p.now?.()??Date.now();
  if(!Number.isFinite(now)||now>=Date.parse(claim.notAfter)||!p.enabled())outcome={status:'blocked'};
  else{
   // No awaited work between deadline/runtime check and transport invocation.
   const sent=await p.transport(claim);
   outcome=sent.status==='accepted'&&sent.recipientId===b.recipientId&&sendMid(sent.messageId)&&sent.delivery==='unconfirmed'
    ?{status:'accepted',recipientId:sent.recipientId,messageId:sent.messageId}
    :sent.status==='rejected'?{status:'rejected'}:sent.status==='blocked'?{status:'blocked'}:{status:'unknown'};
  }
 }catch{outcome={status:'unknown'};}
 let settled:Result;
 try{const r=await p.settle(b,claim.claimReceipt,outcome);settled=r.ok?{ok:true,data:captureSendProgress(r.data,b)}:r;}catch{settled=await readOnce(b,p);}
 return projectAccepted(settled,b,p);
}
/** Recover persistence only. Unknown remains unresolved without exact trusted
 * provider evidence; accepted can repair after session revocation/account transfer.
 * This never calls transport, creates another intent or authorizes a retry. */
export async function reconcileInstagramIntent(supplied:InstagramSendBinding,p:InstagramSendPorts):Promise<Result>{
 try{const b=captureSendBinding(supplied),r=await p.recover(b);return projectAccepted(r.ok?{ok:true,data:captureSendProgress(r.data,b)}:r,b,p);}catch{return unavailable();}
}

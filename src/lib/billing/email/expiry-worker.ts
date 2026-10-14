import 'server-only';
import type {ExpiryEmail} from '../lifecycle';
import type {EmailOutcome} from './contracts';
export type ExpiryEmailClaim=ExpiryEmail&{id:string;claimToken:string;recipient:string;dispatchUntil?:string};
export type ExpiryEmailPorts={claim():Promise<ExpiryEmailClaim|null>;authorize(c:ExpiryEmailClaim):Promise<boolean>;send(c:ExpiryEmailClaim):Promise<EmailOutcome>;finish(c:ExpiryEmailClaim,r:EmailOutcome):Promise<boolean>};
export async function runExpiryEmail(enabled:boolean,ports:ExpiryEmailPorts):Promise<{ok:boolean;accepted?:number;reconciliationRequired?:boolean;code?:string}>{
 if(!enabled)return {ok:false,code:'EMAIL_DISABLED'};
 try{const claim=await ports.claim();if(!claim||!await ports.authorize(claim))return {ok:true,accepted:0};
  let outcome:EmailOutcome;try{outcome=await ports.send(claim);}catch{outcome={kind:'reconciliation_required',code:'RESEND_OUTCOME_UNKNOWN'};}
  if(!await ports.finish(claim,outcome))return {ok:false,code:'EMAIL_RECONCILIATION_REQUIRED'};
  return {ok:true,accepted:outcome.kind==='accepted'?1:0,reconciliationRequired:outcome.kind==='reconciliation_required'};
 }catch{return {ok:false,code:'EMAIL_STORE_UNAVAILABLE'};}
}

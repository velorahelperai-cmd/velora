import type {InstagramSendResult} from './meta';

/** Exact immutable send identity. No browser-supplied authority or current-account fallback. */
export type InstagramSendBinding=Readonly<{companyId:string;actorId:string;sessionId:string;intentId:string;conversationId:string;linkId:string;generation:number;accountId:string;recipientId:string;textHash:string}>;
export type InstagramSendFailureCode='FORBIDDEN'|'NOT_FOUND'|'INVALID_INPUT'|'CONFLICT'|'SEND_DISABLED'|'ENTITLEMENT_DENIED'|'WINDOW_CLOSED'|'BINDING_CHANGED'|'RECONCILIATION_REQUIRED'|'UNAVAILABLE';
export type InstagramSendFailure=Readonly<{ok:false;code:InstagramSendFailureCode}>;
export type InstagramSendResultValue<T>=Readonly<{ok:true;data:T}>|InstagramSendFailure;
/** Claimed/unknown require reconciliation; no timeout/lease creates another attempt. */
export type InstagramSendProgress=Readonly<{binding:InstagramSendBinding;state:'ready'|'claimed'|'unknown'|'blocked'|'rejected'|'accepted';providerMessageId:string|null;projectedMessageId:string|null;delivery:'unconfirmed'}>;
export type InstagramPrepareSend=Readonly<{companyId:string;conversationId:string;intentId:string;text:string}>;
/** Server-internal credential and claim receipt. Never return this from a Server Action. */
export type InstagramFreshSendClaim=Readonly<{kind:'fresh';committed:true;binding:InstagramSendBinding;claimReceipt:string;text:string;accessToken:string;notAfter:string}>;
export type InstagramSendClaim=InstagramFreshSendClaim|Readonly<{kind:'existing';progress:InstagramSendProgress}>|InstagramSendFailure;
export type InstagramSendSettlement=Readonly<{status:'unknown'|'blocked'|'rejected'}>|Readonly<{status:'accepted';recipientId:string;messageId:string}>;
export type InstagramSendStore=Readonly<{
 prepare(input:InstagramPrepareSend):Promise<InstagramSendResultValue<InstagramSendProgress>>;
 read(binding:InstagramSendBinding):Promise<InstagramSendResultValue<InstagramSendProgress>>;
 /** Only a fresh committed claim authorizes ONE immediate transport invocation.
  * SQL rechecks native/app session, membership, explicit IG reply capability,
  * scope, exact historical/current binding, provider proof, entitlement and window.
  * A committed lost response is unresolved, never safe to claim/send again. */
 claim(binding:InstagramSendBinding):Promise<InstagramSendClaim>;
 /** Persist an observed outcome for this exact irreversible claim. May complete
  * after user revocation/account retirement; this records history, not authority. */
 settle(binding:InstagramSendBinding,receipt:string,outcome:InstagramSendSettlement):Promise<InstagramSendResultValue<InstagramSendProgress>>;
 /** Durable accepted evidence is independent of projection repair. No HTTP here. */
 project(binding:InstagramSendBinding):Promise<InstagramSendResultValue<InstagramSendProgress>>;
 /** Server-only: unresolved claimed -> unknown; accepted -> repairable history.
  * No text/time correlation, reset, lease expiration or resend authorization. */
 recover(binding:InstagramSendBinding):Promise<InstagramSendResultValue<InstagramSendProgress>>;
}>;
/** Synthetic ports in tests. Production remains unwired and runtime-disabled. */
export type InstagramSendPorts=Omit<InstagramSendStore,'prepare'>&Readonly<{enabled():boolean;now?():number;transport(claim:InstagramFreshSendClaim):Promise<InstagramSendResult>}>;

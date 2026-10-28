import 'server-only';
import {randomUUID} from 'node:crypto';
import {signupCodeHash} from './signup-checkpoint';
import {exchangeEarlyMetaAuthorization,type MetaSignupConfig,type MetaFetch} from './embedded-signup-meta';
import type {PaidBranchConnectionRpc} from '@/lib/tenancy/paid-branch-connection-store';
export async function earlyAuthorizationRpc(client:PaidBranchConnectionRpc,operation:'reserve'|'save'|'load'|'promote'|'cleanup',binding:Record<string,unknown>,reservation?:string,token?:string):Promise<Record<string,unknown>|null>{
 try{const r=await client.rpc('es02_b3_early_whatsapp_authorization',{p_operation:operation,p_binding:binding,p_reservation:reservation??null,p_token:token??null});return !r.error&&r.data&&typeof r.data==='object'&&!Array.isArray(r.data)&&(r.data as Record<string,unknown>).ok===true?r.data as Record<string,unknown>:null;}catch{return null;}
}
export type EarlyAuthorizationStage='reservation'|'exchange'|'save';
export type EarlyAuthorizationOutcome='started'|'confirmed'|'unknown'|'held'|'already_stored';
export type EarlyAuthorizationDiagnostic=(stage:EarlyAuthorizationStage,outcome:EarlyAuthorizationOutcome,durationMs:number)=>void;
/** Commit reservation before the one-use external exchange. Unknown reservations are never stolen. */
export async function captureEarlyAuthorization(client:PaidBranchConnectionRpc,binding:Record<string,unknown>,code:string,config:MetaSignupConfig,http?:MetaFetch,diagnostic?:EarlyAuthorizationDiagnostic):Promise<boolean>{
 const observe=(stage:EarlyAuthorizationStage,outcome:EarlyAuthorizationOutcome,start:number)=>{try{diagnostic?.(stage,outcome,Math.max(0,Date.now()-start));}catch{/* Diagnostics never change authorization behavior. */}};
 const reservation=randomUUID();
 const reserveStarted=Date.now();observe('reservation','started',reserveStarted);
 const reserved=await earlyAuthorizationRpc(client,'reserve',{...binding,codeHash:signupCodeHash(code)},reservation);
 if(!reserved){observe('reservation','unknown',reserveStarted);return false;}
 if(reserved.acquired!==true){const stored=reserved.stored===true||reserved.promoted===true;observe('reservation',stored?'already_stored':'held',reserveStarted);return stored;}
 observe('reservation','confirmed',reserveStarted);
 const exchangeStarted=Date.now();observe('exchange','started',exchangeStarted);
 const exchanged=await exchangeEarlyMetaAuthorization(config,code,http);
 if(!exchanged.ok){observe('exchange','unknown',exchangeStarted);return false;}
 observe('exchange','confirmed',exchangeStarted);
 // Retry the idempotent save only, using the SAME token and reservation, never re-exchange.
 for(let n=0;n<2;n++){const saveStarted=Date.now();observe('save','started',saveStarted);if(await earlyAuthorizationRpc(client,'save',binding,reservation,exchanged.token)){observe('save','confirmed',saveStarted);return true;}observe('save','unknown',saveStarted);}
 return false;
}

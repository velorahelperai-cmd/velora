import 'server-only';
import {randomUUID} from 'node:crypto';
import {signupCodeHash} from './signup-checkpoint';
import {exchangeEarlyMetaAuthorization,type MetaSignupConfig,type MetaFetch} from './embedded-signup-meta';
import type {PaidBranchConnectionRpc} from '@/lib/tenancy/paid-branch-connection-store';
export async function earlyAuthorizationRpc(client:PaidBranchConnectionRpc,operation:'reserve'|'save'|'load'|'promote'|'cleanup',binding:Record<string,unknown>,reservation?:string,token?:string):Promise<Record<string,unknown>|null>{
 try{const r=await client.rpc('es02_b3_early_whatsapp_authorization',{p_operation:operation,p_binding:binding,p_reservation:reservation??null,p_token:token??null});return !r.error&&r.data&&typeof r.data==='object'&&!Array.isArray(r.data)&&(r.data as Record<string,unknown>).ok===true?r.data as Record<string,unknown>:null;}catch{return null;}
}
/** Commit reservation before the one-use external exchange. Unknown reservations are never stolen. */
export async function captureEarlyAuthorization(client:PaidBranchConnectionRpc,binding:Record<string,unknown>,code:string,config:MetaSignupConfig,http?:MetaFetch):Promise<boolean>{
 const reservation=randomUUID();
 const reserved=await earlyAuthorizationRpc(client,'reserve',{...binding,codeHash:signupCodeHash(code)},reservation);
 if(!reserved)return false;
 if(reserved.acquired!==true)return reserved.stored===true||reserved.promoted===true;
 const exchanged=await exchangeEarlyMetaAuthorization(config,code,http);
 if(!exchanged.ok)return false;
 // Retry the idempotent save only, using the SAME token and reservation, never re-exchange.
 for(let n=0;n<2;n++)if(await earlyAuthorizationRpc(client,'save',binding,reservation,exchanged.token))return true;
 return false;
}

import 'server-only';
import {createHash} from 'node:crypto';
import type {PaidBranchConnectionRpc} from '@/lib/tenancy/paid-branch-connection-store';
import type {PaidBranchConnectionAttemptRequest} from '@/lib/tenancy/paid-branch-connection-flow';
export type SignupCheckpoint={token:string;nonce:string;wabaId:string;phoneNumberId:string;appId:string;configId:string;graphVersion:string};
export function signupCheckpointBinding(request:PaidBranchConnectionAttemptRequest,sessionId:string){
 return {accountId:request.expectedAccountId,companyId:request.companyId,branchId:request.branchId,attemptId:request.attemptId,generation:request.generation,sessionId};
}
/** Service-only RPC; never log its arguments or result. No code/PIN is persisted. */
export async function signupCheckpointRpc(client:PaidBranchConnectionRpc,operation:'ready'|'reserve'|'save'|'load'|'discard',binding:Record<string,unknown>,reservation?:string,token?:string):Promise<Record<string,unknown>|null>{
 try{const result=await client.rpc('es02_b3_whatsapp_signup_checkpoint',{p_operation:operation,p_binding:binding,p_reservation:reservation??null,p_token:token??null});
  if(result.error||!result.data||typeof result.data!=='object'||Array.isArray(result.data))return null;
  const row=result.data as Record<string,unknown>;return row.ok===true?row:null;
 }catch{return null;}
}
export function signupCodeHash(code:string){return createHash('sha256').update(code).digest('hex');}
export function parseSignupCheckpoint(value:Record<string,unknown>|null):SignupCheckpoint|null{
 if(!value||typeof value.token!=='string'||!value.token||value.token.length>16384||typeof value.nonce!=='string'||!/^[a-f0-9]{64}$/.test(value.nonce))return null;
 if(!['wabaId','phoneNumberId','appId','configId'].every(k=>typeof value[k]==='string'&&/^\d{1,64}$/.test(value[k] as string))||typeof value.graphVersion!=='string'||!/^v\d+\.0$/.test(value.graphVersion))return null;
 return value as unknown as SignupCheckpoint;
}

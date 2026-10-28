"use server";
import {readSessionIdentity} from '@/lib/auth/server-identity';
import {createClient} from '@/lib/supabase/server';
import type {PaidBranchConnectionScope} from './paid-branch-connection-contracts';
export type WhatsappReviewRequestInput=PaidBranchConnectionScope&{attemptId:string;generation:number;request:boolean};
export type WhatsappReviewReceipt={id:string;attemptId:string;generation:number;status:'pending';requestedAt:string};
export type WhatsappReviewRequestResult={ok:true;receipt:WhatsappReviewReceipt|null}|{ok:false};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Persist or read pending administrative review. Never invokes a provider or decrypts a checkpoint. */
export async function ownedWhatsappReviewRequestAction(input:WhatsappReviewRequestInput):Promise<WhatsappReviewRequestResult>{
 try{
 if(!input||input.channel!=='whatsapp'||![input.expectedAccountId,input.companyId,input.branchId,input.attemptId].every(value=>typeof value==='string'&&uuid.test(value))||!Number.isSafeInteger(input.generation)||input.generation<1||typeof input.request!=='boolean')return {ok:false};
 const identity=await readSessionIdentity();if(!identity.ok||identity.userId!==input.expectedAccountId)return {ok:false};
 const client=await createClient(),claims=await client.auth.getClaims();const sessionId=claims.data?.claims?.session_id;
 if(claims.error||claims.data?.claims?.sub!==input.expectedAccountId||typeof sessionId!=='string'||!uuid.test(sessionId))return {ok:false};
 const result=await client.rpc('wa_owned_checkpoint_review_request' as never,{p_expected_account_id:input.expectedAccountId,p_session_id:sessionId,p_company_id:input.companyId,p_branch_id:input.branchId,p_attempt_id:input.attemptId,p_generation:input.generation,p_request:input.request} as never);
 const data=result.data as {ok?:boolean;receipt?:WhatsappReviewReceipt|null}|null;
 if(result.error||data?.ok!==true)return {ok:false};
 const r=data.receipt;if(r===null)return input.request?{ok:false}:{ok:true,receipt:null};
 if(!r||!uuid.test(r.id)||r.attemptId!==input.attemptId||r.generation!==input.generation||r.status!=='pending'||!Number.isFinite(Date.parse(r.requestedAt)))return {ok:false};
 return {ok:true,receipt:{id:r.id,attemptId:r.attemptId,generation:r.generation,status:'pending',requestedAt:r.requestedAt}};
 }catch{return {ok:false};}
}

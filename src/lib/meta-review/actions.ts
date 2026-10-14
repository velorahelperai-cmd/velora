'use server';
import {createHash,randomBytes} from 'node:crypto';
import {createClient} from '@/lib/supabase/server';
import {getCompanyAccess,requirePlatformAdmin} from '@/lib/tenancy/access';
import {parseReviewGrant,type ReviewChannel} from './access';
type Rpc={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const fail=()=>({ok:false as const,code:'REVIEW_UNAVAILABLE'});
export async function readChannelReviewAccess(companyId:string,channel:ReviewChannel){
 if(!uuid(companyId)||!['whatsapp','instagram'].includes(channel))return fail();
 try{const access=await getCompanyAccess();if(!access.ok||access.context.company?.id!==companyId||access.context.membership?.role!=='owner')return fail();
  const {data,error}=await(await createClient() as unknown as Rpc).rpc('read_channel_review_access',{p_company_id:companyId,p_channel:channel});
  const grant=!error&&data&&typeof data==='object'&&'ok' in data&&data.ok===true&&'grant' in data?parseReviewGrant(data.grant):null;
  return grant?{ok:true as const,grant}:fail();
 }catch{return fail();}
}
export async function adminGrantChannelReview(input:{companyId:string;channel:ReviewChannel;assetId:string;sourceAccountId:string;recipientIds:string[]}){
 if(!uuid(input?.companyId)||!['whatsapp','instagram'].includes(input.channel)||![input.assetId,input.sourceAccountId].every(v=>/^[0-9]{1,64}$/.test(v))
 ||!Array.isArray(input.recipientIds)||input.recipientIds.length<1||input.recipientIds.length>5||input.recipientIds.some(v=>!(/^[1-9][0-9]{1,63}$/).test(v)))return fail();
 try{if(!(await requirePlatformAdmin()).ok)return fail();
  const wa=input.channel==='whatsapp';
  if(wa&&(process.env.WHATSAPP_CONFIGURATION_MODE!=='meta_test'||process.env.WHATSAPP_TEST_COMPANY_ID!==input.companyId
   ||process.env.WHATSAPP_TEST_PHONE_NUMBER_ID!==input.assetId||process.env.WHATSAPP_TEST_WABA_ID!==input.sourceAccountId))return fail();
  if(!wa&&(process.env.INSTAGRAM_REVIEW_ENABLED!=='true'||process.env.INSTAGRAM_REVIEW_COMPANY_ID!==input.companyId||input.sourceAccountId!==input.assetId))return fail();
  const appId=process.env[wa?'WHATSAPP_EMBEDDED_SIGNUP_APP_ID':'INSTAGRAM_APP_ID'];
  const secret=process.env[wa?'WHATSAPP_APP_SECRET':'INSTAGRAM_PARENT_WEBHOOK_APP_SECRET'];
  if(!appId||!secret)return fail();
  const {data,error}=await(await createClient() as unknown as Rpc).rpc('admin_grant_channel_review',{p_company_id:input.companyId,p_channel:input.channel,
   p_app_id:appId,p_asset_id:input.assetId,p_source_account_id:input.sourceAccountId,p_recipient_ids:input.recipientIds,p_webhook_secret_sha256:createHash('sha256').update(secret).digest('hex')});
  const grant=!error&&data&&typeof data==='object'&&'ok' in data&&data.ok===true&&'grant' in data?parseReviewGrant(data.grant):null;
  return grant?{ok:true as const,grant}:fail();
 }catch{return fail();}
}
export async function adminRevokeChannelReview(grantId:string){
 if(!uuid(grantId))return fail();
 try{if(!(await requirePlatformAdmin()).ok)return fail();const {data,error}=await(await createClient() as unknown as Rpc).rpc('admin_revoke_channel_review',{p_grant_id:grantId});
 return !error&&data&&typeof data==='object'&&'ok' in data&&data.ok===true?{ok:true as const}:fail();}catch{return fail();}
}
export async function adminStartInstagramReviewBootstrap(companyId:string,reuseChallenge?:string){
 if(!uuid(companyId)||process.env.INSTAGRAM_REVIEW_ENABLED!=='true'||process.env.INSTAGRAM_REVIEW_COMPANY_ID!==companyId)return fail();
 if(reuseChallenge!==undefined&&!/^VELORA-REVIEW-[a-f0-9]{24}$/.test(reuseChallenge))return fail();
 try{if(!(await requirePlatformAdmin()).ok)return fail();
  const app=process.env.INSTAGRAM_APP_ID,parent=process.env.INSTAGRAM_PARENT_WEBHOOK_APP_ID,secret=process.env.INSTAGRAM_PARENT_WEBHOOK_APP_SECRET;
  if(!app||!parent||!secret)return fail();
  const nonce=reuseChallenge??'VELORA-REVIEW-'+randomBytes(12).toString('hex');
  const {data,error}=await(await createClient() as unknown as Rpc).rpc('admin_begin_instagram_review_bootstrap',{p_company_id:companyId,p_app_id:app,p_parent_app_id:parent,p_secret_fingerprint:createHash('sha256').update(secret).digest('hex'),p_nonce_sha256:createHash('sha256').update(nonce).digest('hex')});
  if(error||!data||typeof data!=='object'||!('ok' in data)||data.ok!==true||!('expires_at' in data)||typeof data.expires_at!=='string')return fail();
  return {ok:true as const,nonce,expiresAt:data.expires_at};
 }catch{return fail();}
}
export async function adminReadInstagramReviewBootstrap(companyId:string){
 if(!uuid(companyId))return fail();
 try{if(!(await requirePlatformAdmin()).ok)return fail();
  const {data,error}=await(await createClient() as unknown as Rpc).rpc('admin_read_instagram_review_bootstrap',{p_company_id:companyId});
  if(error||!data||typeof data!=='object'||!('ok' in data)||data.ok!==true||!('observed' in data)||typeof data.observed!=='boolean')return fail();
  return {ok:true as const,observed:data.observed,accountId:'account_id' in data&&typeof data.account_id==='string'?data.account_id:null,senderId:'sender_id' in data&&typeof data.sender_id==='string'?data.sender_id:null};
 }catch{return fail();}
}

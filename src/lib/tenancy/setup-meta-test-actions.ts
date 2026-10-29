'use server';
import {createHash} from 'node:crypto';
import {readSessionIdentity} from '@/lib/auth/server-identity';
import {onboardMetaSignup} from '@/lib/whatsapp/embedded-signup-meta';
import {checkRateLimit} from '@/lib/security/rate-limit';
import {readOwnedPaidBranchSetupAction} from './paid-setup-actions';
import {setupMetaTestConfig,type SetupMetaTestScope} from './setup-meta-test';
import type {PaidBranchSetupRead} from './paid-setup-contracts';
export type SetupMetaTestAccess={scope:SetupMetaTestScope;expiresAt:string;authorityFingerprint:string;read:PaidBranchSetupRead};
export type SetupMetaTestInspection={status:'unknown';code:string}|{status:'verified_test_asset';displayNumber:string};

/** Same paid owner authority used by the real settings and trial RPCs. No channel proof is merged. */
export async function readOwnedSetupMetaTestAction(scope:SetupMetaTestScope):Promise<SetupMetaTestAccess|null>{
 try{
  const config=setupMetaTestConfig(scope,process.env);if(!config)return null;
  const before=await readSessionIdentity();
  if(!before.ok||before.userId!==scope.expectedAccountId||!before.nativeSessionId)return null;
  const read=await readOwnedPaidBranchSetupAction(scope);
  if(read.sourceStatus!=='ready'||!read.entitlement||read.companyId!==scope.companyId||read.selectedBranchId!==scope.branchId)return null;
  const after=await readSessionIdentity();
  if(!after.ok||after.userId!==before.userId||after.nativeSessionId!==before.nativeSessionId
   ||JSON.stringify(setupMetaTestConfig(scope,process.env))!==JSON.stringify(config))return null;
  return {scope:{expectedAccountId:scope.expectedAccountId,companyId:scope.companyId,branchId:scope.branchId},expiresAt:config.expiresAt,authorityFingerprint:createHash('sha256').update(before.nativeSessionId).digest('hex'),read};
 }catch{return null;}
}

/** Exact configured test asset only; the adapter cannot register, subscribe or exchange OAuth here. */
export async function inspectOwnedSetupMetaTestAction(scope:SetupMetaTestScope):Promise<SetupMetaTestInspection>{
 try{
  const access=await readOwnedSetupMetaTestAction(scope),config=setupMetaTestConfig(scope,process.env);
  if(!access||!config)return {status:'unknown',code:'ACCESS_UNAVAILABLE'};
  const rate=await checkRateLimit('ai_trial',`company:${scope.companyId}:meta-probe`);
  if(!rate.allowed)return {status:'unknown',code:rate.code};
  const token=process.env.WHATSAPP_TEST_ACCESS_TOKEN,appSecret=process.env.WHATSAPP_APP_SECRET;
  if(!token||!appSecret)return {status:'unknown',code:'CREDENTIALS_UNAVAILABLE'};
  const getOnly:typeof fetch=async(input,init)=>{
   if(typeof input!=='string'||init?.method!=='GET')throw Error('READ_ONLY_REQUIRED');
   const url=new URL(input);
   if(url.origin!=='https://graph.facebook.com'||!url.pathname.startsWith(`/${config.graphVersion}/`)||url.pathname.includes('/oauth/'))throw Error('READ_ONLY_REQUIRED');
   return fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(8000),redirect:'error'});
  };
  const result=await onboardMetaSignup({enabled:true,appId:config.appId,appSecret,graphVersion:config.graphVersion},
   {code:'saved-test-asset-read',wabaId:config.wabaId,phoneNumberId:config.phoneNumberId,pin:'',keepOnPhone:false},getOnly,{token,readOnly:true});
  const current=await readOwnedSetupMetaTestAction(scope);
  if(!current||current.authorityFingerprint!==access.authorityFingerprint||current.expiresAt!==access.expiresAt||JSON.stringify(setupMetaTestConfig(scope,process.env))!==JSON.stringify(config))return {status:'unknown',code:'ACCESS_CHANGED'};
  if(!result.ok)return {status:'unknown',code:result.code};
  if(result.proof.app_id!==config.appId||result.proof.waba_id!==config.wabaId||result.proof.phone_number_id!==config.phoneNumberId)return {status:'unknown',code:'ASSET_MISMATCH'};
  return {status:'verified_test_asset',displayNumber:result.proof.display_phone_number};
 }catch{return {status:'unknown',code:'META_UNAVAILABLE'};}
}

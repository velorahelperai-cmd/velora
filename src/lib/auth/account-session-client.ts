import {authCorrelationHeaders} from '@/lib/diagnostics/correlation.mjs';
import type {AccountSessionRead} from './account-profile-contract';

/** One private GET, independent of Next's mutation queue. No fallback to stale
 * identity and no persisted cache; the provider still owns its capture epoch. */
export async function fetchAccountSession(correlation?:unknown):Promise<AccountSessionRead>{
 try{
  const response=await fetch('/api/account/session',{method:'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(45000),headers:authCorrelationHeaders(correlation)});
  const result=await response.json() as AccountSessionRead;
  if(!result||typeof result.ok!=='boolean')return {ok:false,code:'UNAVAILABLE'};
  if(!result.ok)return {ok:false,code:['UNAUTHENTICATED','QUARANTINED','CONFLICT'].includes(result.code)?result.code:'UNAVAILABLE'};
  if(!response.ok||[result.userId,result.boundaryFingerprint,result.nativeSessionId,result.generation].some(value=>typeof value!=='string'||!value)||!Number.isSafeInteger(result.contextGeneration))return {ok:false,code:'CONFLICT'};
  return result;
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}

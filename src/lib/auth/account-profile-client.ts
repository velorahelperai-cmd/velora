import type {AccountBoundaryExpectation,AttestedAccountProfile} from './account-profile-contract';
import {authCorrelationHeaders} from '@/lib/diagnostics/correlation.mjs';

/** Private read transport only. No mutation queue, persistent cache, or fallback
 * to an older profile/attestation after a failed request. */
export async function fetchAttestedAccountProfile(expected:AccountBoundaryExpectation,correlation?:unknown):Promise<AttestedAccountProfile>{
 try{
  const response=await fetch('/api/account/profile',{method:'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(45000),headers:{...authCorrelationHeaders(correlation),'x-velora-account':expected.userId,'x-velora-boundary':expected.boundaryFingerprint,'x-velora-generation':expected.generation}});
  const result=await response.json() as AttestedAccountProfile;
  if(!result||typeof result.ok!=='boolean')return {ok:false,code:'UNAVAILABLE'};
  if(!result.ok)return result.code==='CONFLICT'?{ok:false,code:'CONFLICT'}:result.code==='UNAUTHENTICATED'?{ok:false,code:'UNAUTHENTICATED',...(result.sessionExpired===true?{sessionExpired:true}:{})}:{ok:false,code:'UNAVAILABLE'};
  const attestation=result.attestation;
  if(!response.ok||!attestation||attestation.ok!==true||attestation.userId!==expected.userId||attestation.boundaryFingerprint!==expected.boundaryFingerprint||attestation.generation!==expected.generation||result.data?.userId!==attestation.userId||typeof attestation.nativeSessionId!=='string'||!attestation.nativeSessionId||!Number.isSafeInteger(attestation.contextGeneration))return {ok:false,code:'CONFLICT'};
  return result;
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}

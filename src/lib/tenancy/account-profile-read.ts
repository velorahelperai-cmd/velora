import 'server-only';
import {withAuthDiagnostic} from '@/lib/diagnostics/server-flow';
import {traceRead} from '@/lib/diagnostics/read-performance';
import {readScopedSessionIdentity} from '@/lib/auth/server-identity';
import {checkAppSession} from '@/lib/auth/session-guard';
import {authFlowHref} from '@/lib/auth/auth-journey';
import {createClient,runWithVerifiedReadClient,VerifiedReadBoundaryError} from '@/lib/supabase/server';
import {getCompanyAccess,buildAccountProfileView} from './access';
import {readAccountPlatformIdentity,unavailablePlatformIdentity} from './account-platform-identity';
import type {AccountBoundaryExpectation,AttestedAccountProfile} from '@/lib/auth/account-profile-contract';

/** Expected browser fields only reject a changed account. Native identity,
 * session and company access establish all authority. No result escapes the
 * operation until the uncached final broker/cookie fence completes. */
export async function readAttestedAccountProfile(expected?:AccountBoundaryExpectation,correlation?:unknown):Promise<AttestedAccountProfile>{
 return withAuthDiagnostic('auth_session_check',correlation,async trace=>{
  try{
   const {value:result,actorId}=await traceRead('account_profile',()=>runWithVerifiedReadClient(async():Promise<AttestedAccountProfile>=>{
    trace.stage('session');
    const identity=await readScopedSessionIdentity();
    if(!identity.ok)return {ok:false,code:identity.code,...('expired' in identity&&identity.expired?{sessionExpired:true}:{})};
    if(expected&&(identity.userId!==expected.userId||identity.boundaryFingerprint!==expected.boundaryFingerprint||identity.generation!==expected.generation))return {ok:false,code:'CONFLICT'};
    trace.stage('access');
    const [access,platformIdentity]=await Promise.all([
     getCompanyAccess(),
     identity.emailConfirmed?readAccountPlatformIdentity(identity.userId):Promise.resolve(unavailablePlatformIdentity()),
    ]);
    if(access.ok&&access.context.userId!==identity.userId)return {ok:false,code:'UNAVAILABLE'};
    if(!access.ok&&access.code==='UNAUTHENTICATED')return {ok:false,code:'UNAUTHENTICATED',...('sessionExpired' in access&&access.sessionExpired?{sessionExpired:true}:{})};
    // The private GET replaces the later browser status round trip. Recheck
    // idle/native session after profile reads, before the final broker fence.
    if(expected){
     const guard=await checkAppSession(await createClient());
     if(!guard.ok)return {ok:false,code:guard.code,...(guard.expired?{sessionExpired:true}:{})};
    }
    const data=access.ok
     ? {...buildAccountProfileView(access,platformIdentity),emailConfirmed:identity.emailConfirmed,sessionExpiresAt:identity.sessionExpiresAt}
     : {platformIdentity,userId:identity.userId,email:identity.email,fullName:identity.fullName,supportCode:'',isPlatformAdmin:false,role:null,companyName:null,companyId:null,needsCompanyContext:false,adminHref:null,workspaceHref:null,workHref:identity.emailConfirmed?'/account':authFlowHref('/verify-email',null,identity.email),emailConfirmed:identity.emailConfirmed,sessionExpiresAt:identity.sessionExpiresAt,accessUnavailable:access.code==='UNAVAILABLE'};
    return {ok:true,data,attestation:{ok:true,userId:identity.userId,boundaryFingerprint:identity.boundaryFingerprint,nativeSessionId:identity.nativeSessionId,contextGeneration:identity.contextGeneration,generation:identity.generation}};
   }));
   if(result.ok&&result.data.userId!==actorId){trace.finish('UNAVAILABLE');return {ok:false,code:'UNAVAILABLE'};}
   trace.finish(result.ok?'OK':result.code);return result;
  }catch(error){
   // A changed cookie/broker boundary is not proof that the new account is
   // logged out. Hide the old view without broadcasting a logout for it.
   const code=error instanceof VerifiedReadBoundaryError?(expected&&(error.message==='READ_BOUNDARY_CHANGED'||error.code==='UNAUTHENTICATED')?'CONFLICT':error.code):'UNAVAILABLE';
   trace.finish(code);return {ok:false,code};
  }
 });
}

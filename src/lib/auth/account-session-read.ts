import 'server-only';
import {runWithVerifiedReadClient,VerifiedReadBoundaryError} from '@/lib/supabase/server';
import {withAuthDiagnostic} from '@/lib/diagnostics/server-flow';
import {traceRead} from '@/lib/diagnostics/read-performance';
import {readScopedSessionIdentity} from './server-identity';
import type {AccountSessionRead} from './account-profile-contract';

/** Independent read transport replaces the protected-page action, not its
 * authority checks. Native getUser + idle guard precede a fresh broker fence.
 * No profile/company payload, cached authorization, or cookie writer escapes. */
export async function readAccountSession(correlation?:unknown):Promise<AccountSessionRead>{
 return withAuthDiagnostic('auth_session_check',correlation,async trace=>{
  try{
   trace.stage('session');
   const {value,actorId}=await traceRead('account_session',()=>runWithVerifiedReadClient(async():Promise<AccountSessionRead>=>{
    const identity=await readScopedSessionIdentity();
    if(!identity.ok)return {ok:false,code:identity.code};
    return {ok:true,userId:identity.userId,boundaryFingerprint:identity.boundaryFingerprint,nativeSessionId:identity.nativeSessionId,contextGeneration:identity.contextGeneration,generation:identity.generation};
   }));
   if(value.ok&&value.userId!==actorId){trace.finish('CONFLICT');return {ok:false,code:'CONFLICT'};}
   trace.finish(value.ok?'OK':value.code==='QUARANTINED'?'FORBIDDEN':value.code);return value;
  }catch(error){
   const code=error instanceof VerifiedReadBoundaryError?(error.message==='READ_BOUNDARY_CHANGED'?'CONFLICT':error.code):'UNAVAILABLE';
   trace.finish(code);return {ok:false,code};
  }
 });
}

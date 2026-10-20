import {cookies} from 'next/headers';
import {completeInstagramOwnerOAuth,cancelInstagramOwnerOAuth} from '@/lib/instagram/owner-actions';
import {readInstagramOAuthConfig} from '@/lib/instagram/oauth-meta';
import {handleInstagramOAuthCallback,INSTAGRAM_ATTEMPT_COOKIE} from '@/lib/instagram/oauth-route';
import {cancelOwnedInstagramCallback,classifyOwnedInstagramAttempt,completeOwnedInstagramCallback} from '@/lib/tenancy/paid-branch-connection-actions';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const cookie=await cookies(),cfg=readInstagramOAuthConfig();
 const origin=cfg?new URL(cfg.redirectUri).origin:'https://www.velorahelper.com';
 return handleInstagramOAuthCallback(request,{appOrigin:origin,readAttempt:async()=>cookie.get(INSTAGRAM_ATTEMPT_COOKIE)?.value,complete:completeInstagramOwnerOAuth,cancel:cancelInstagramOwnerOAuth,
  classify:classifyOwnedInstagramAttempt,completeBranch:completeOwnedInstagramCallback,cancelBranch:cancelOwnedInstagramCallback,
  clearAttempt:async()=>{cookie.set(INSTAGRAM_ATTEMPT_COOKIE,'',{httpOnly:true,secure:new URL(origin).protocol==='https:',sameSite:'lax',path:'/api/instagram/oauth/callback',maxAge:0});}});
}

import { createHash, timingSafeEqual } from 'node:crypto';

/** Challenge verification only: never accepts events, stores messages or grants access. */
export function instagramWebhookChallenge(request: Request,
  env: Readonly<Record<string,string|undefined>> = process.env, now = Date.now()): Response | null {
  if (env.INSTAGRAM_WEBHOOK_CHALLENGE_ENABLED !== 'true') return null;
  const deny = (status:number) => Response.json({ok:false,code:status===503?'NEEDS_SETUP':'FORBIDDEN'},
    {status,headers:{'cache-control':'no-store'}});
  try {
    const raw=env.INSTAGRAM_WEBHOOK_CHALLENGE_SCOPE;
    if (!raw || raw.length>2048 || !Number.isFinite(now)) return deny(503);
    const scope=JSON.parse(raw);
    const keys=['parentAppId','secretSha256','validFrom','expiresAt'];
    if (!scope || typeof scope!=='object' || Array.isArray(scope) || Object.keys(scope).length!==keys.length
      || keys.some(k=>typeof scope[k]!=='string') || !/^\d{1,64}$/.test(scope.parentAppId)
      || !/^[a-f0-9]{64}$/.test(scope.secretSha256)) return deny(503);
    const start=Date.parse(scope.validFrom),end=Date.parse(scope.expiresAt);
    if (![scope.validFrom,scope.expiresAt].every(v=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v))
      || !Number.isFinite(start) || !Number.isFinite(end) || end<=start || end-start>48*3600000
      || now<start || now>=end || env.INSTAGRAM_PARENT_WEBHOOK_APP_ID!==scope.parentAppId) return deny(503);
    const secret=env.INSTAGRAM_PARENT_WEBHOOK_APP_SECRET, token=env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    if (!secret || secret!==secret.trim() || !token || token!==token.trim() || token.length>512
      || createHash('sha256').update(secret).digest('hex')!==scope.secretSha256) return deny(503);
    const params=new URL(request.url).searchParams;
    if (request.method!=='GET' || ['hub.mode','hub.verify_token','hub.challenge'].some(k=>params.getAll(k).length!==1)) return deny(403);
    const supplied=params.get('hub.verify_token')!,challenge=params.get('hub.challenge')!;
    const a=Buffer.from(supplied),b=Buffer.from(token);
    if (params.get('hub.mode')!=='subscribe' || !challenge || Buffer.byteLength(challenge)>4096
      || a.length!==b.length || !timingSafeEqual(a,b)) return deny(403);
    return new Response(challenge,{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
  } catch { return deny(503); }
}

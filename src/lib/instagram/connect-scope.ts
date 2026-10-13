import 'server-only';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const utc=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
/** Server-only staged connection rollout. Native membership/session/nonce and DB
 * claim gates still apply. A scope never enables receive, send, billing or AI.
 * Config is deliberately re-read at each irreversible provider boundary. */
export function instagramOwnerConnectScope(companyId:string,userId:string,appId:string,
 environment:Readonly<Record<string,string|undefined>>=process.env,now=Date.now()):boolean{
 const raw=environment.INSTAGRAM_CONNECT_SCOPES;
 if(!raw||raw.length>16384||!uuid(companyId)||!uuid(userId)||!/^\d{1,64}$/.test(appId)||!Number.isFinite(now))return false;
 try{
  const scopes:unknown=JSON.parse(raw);if(!Array.isArray(scopes)||scopes.length<1||scopes.length>100)return false;
  let matches=0;
  for(const v of scopes){
   if(v===null||typeof v!=='object'||Array.isArray(v))return false;
   const s=v as Record<string,unknown>,keys=['companyId','ownerId','appId','validFrom','expiresAt'];
   if(Object.keys(s).length!==keys.length||keys.some(k=>!(k in s))||!uuid(s.companyId)||!uuid(s.ownerId)
    ||typeof s.appId!=='string'||!/^\d{1,64}$/.test(s.appId)||!utc(s.validFrom)||!utc(s.expiresAt))return false;
   const start=Date.parse(s.validFrom),end=Date.parse(s.expiresAt);
   if(end<=start||end-start>48*60*60*1000)return false;
   if(s.companyId===companyId&&s.ownerId===userId&&s.appId===appId&&start<=now&&now<end)matches++;
  }
  return matches===1;
 }catch{return false;}
}

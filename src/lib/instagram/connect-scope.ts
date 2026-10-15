import 'server-only';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const utc=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
/** Server-only staged connection rollout. Native membership/session/nonce and DB
 * claim gates still apply. A scope never enables receive, send, billing or AI.
 * Config is deliberately re-read at each irreversible provider boundary. */
function readInstagramOwnerConnectScope(companyId:string,userId:string,appId:string,
 environment:Readonly<Record<string,string|undefined>>=process.env,now=Date.now()):Readonly<{expectedUsername:string|null}>|null{
 const review=environment.INSTAGRAM_REVIEW_ENABLED==='true'&&environment.INSTAGRAM_REVIEW_COMPANY_ID===companyId&&environment.INSTAGRAM_REVIEW_CONNECT_SCOPES!==undefined;
 const raw=review?environment.INSTAGRAM_REVIEW_CONNECT_SCOPES:environment.INSTAGRAM_CONNECT_SCOPES;
 if(!raw||raw.length>16384||!uuid(companyId)||!uuid(userId)||!/^\d{1,64}$/.test(appId)||!Number.isFinite(now))return null;
 try{
  const scopes:unknown=JSON.parse(raw);if(!Array.isArray(scopes)||scopes.length<1||scopes.length>100)return null;
  let match:Readonly<{expectedUsername:string|null}>|null=null;let matches=0;
  for(const v of scopes){
   if(v===null||typeof v!=='object'||Array.isArray(v))return null;
   const s=v as Record<string,unknown>,keys=review?['companyId','ownerId','appId','validFrom','expiresAt']:['companyId','ownerId','appId','validFrom','expiresAt','expectedUsername'];
   if(Object.keys(s).length!==keys.length||keys.some(k=>!(k in s))||!uuid(s.companyId)||!uuid(s.ownerId)
    ||(!review&&(typeof s.expectedUsername!=='string'||!/^[a-z0-9._]{1,30}$/.test(s.expectedUsername)))||typeof s.appId!=='string'||!/^\d{1,64}$/.test(s.appId)||!utc(s.validFrom)||!utc(s.expiresAt))return null;
   const start=Date.parse(s.validFrom),end=Date.parse(s.expiresAt);
   if(end<=start||end-start>(review?7*24:48)*60*60*1000)return null;
   if(s.companyId===companyId&&s.ownerId===userId&&s.appId===appId&&start<=now&&now<end){matches++;match={expectedUsername:review?null:s.expectedUsername as string};}
  }
  return matches===1?match:null;
 }catch{return null;}
}

export function instagramOwnerConnectScope(companyId:string,userId:string,appId:string,
 environment:Readonly<Record<string,string|undefined>>=process.env,now=Date.now()):boolean{
 return readInstagramOwnerConnectScope(companyId,userId,appId,environment,now)!==null;
}
/** Only the genuine server-observed /me.username is accepted. Browser claims,
 * absent username, another account and expired scopes never provide fallback. */
export function instagramOwnerConnectProfile(companyId:string,userId:string,appId:string,username:unknown,
 environment:Readonly<Record<string,string|undefined>>=process.env,now=Date.now()):boolean{
 const scope=readInstagramOwnerConnectScope(companyId,userId,appId,environment,now);
 return scope!==null&&typeof username==='string'&&/^[a-z0-9._]{1,30}$/i.test(username)
  &&(scope.expectedUsername===null||username.toLowerCase()===scope.expectedUsername);
}

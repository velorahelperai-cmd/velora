import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const f=vi.hoisted(()=>({config:vi.fn(),scope:vi.fn(),profile:vi.fn()}));vi.mock('./config',()=>({instagramConfig:f.config}));vi.mock('./connect-scope',()=>({instagramOwnerConnectScope:f.scope,instagramOwnerConnectProfile:f.profile}));
import {instagramAuthorizationUrl,exchangeInstagramCode} from './oauth-meta';
import {completeInstagramConnection} from './connection-flow';
const cfg={appId:'1000',appSecret:'synthetic-app-secret',contractId:'instagram-login-v26',redirectUri:'https://www.velorahelper.com/api/instagram/oauth/callback',requiredPermissions:['instagram_business_basic','instagram_business_manage_messages']};
const binding={companyId:'abcdefab-0000-4000-8000-000000000001',userId:'abcdefab-0000-4000-8000-000000000011',sessionId:'abcdefab-0000-4000-8000-000000000021',attemptId:'abcdefab-0000-4000-8000-000000000003',generation:1,appId:cfg.appId,contractId:cfg.contractId};
beforeEach(()=>{vi.clearAllMocks();f.scope.mockReturnValue(true);f.profile.mockImplementation((_company:string,_owner:string,_app:string,username:unknown)=>username==='synthetic-business');f.config.mockReturnValue({graphVersion:'v26.0',connectEnabled:true});});
function transport(change?:unknown){return vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({access_token:'synthetic-short-token',user_id:'100',permissions:cfg.requiredPermissions}))).mockResolvedValueOnce(new Response(JSON.stringify({access_token:'synthetic-long-token',expires_in:3600}))).mockResolvedValueOnce(new Response(JSON.stringify(change??{user_id:'100',username:'synthetic-business',account_type:'BUSINESS'})));}
it('keeps authorize/code exchange closed before any HTTP',async()=>{f.config.mockReturnValue({graphVersion:'v26.0',connectEnabled:false});const http=transport();expect(instagramAuthorizationUrl(cfg,'a'.repeat(64))).toBeNull();expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'REJECTED'});expect(http).not.toHaveBeenCalled();});
it('authorize URL contains only public app/redirect/scopes and opaque state',()=>{const url=new URL(instagramAuthorizationUrl(cfg,'a'.repeat(64))!);expect(url.origin).toBe('https://www.instagram.com');expect(url.searchParams.get('response_type')).toBe('code');expect(url.searchParams.get('scope')).toBe(cfg.requiredPermissions.join(','));expect(url.href).not.toContain(cfg.appSecret);});
it('exchanges one code, upgrades once and proves exact professional identity',async()=>{const http=transport();const result=await exchangeInstagramCode('synthetic-code',binding,cfg,{fetch:http});expect(result).toMatchObject({ok:true,accessToken:'synthetic-long-token',evidence:{appId:'1000',accountId:'100',permissions:cfg.requiredPermissions,contractId:cfg.contractId}});expect(http).toHaveBeenCalledTimes(3);expect(http.mock.calls[0][0]).toBe('https://api.instagram.com/oauth/access_token');const init=http.mock.calls[0][1] as RequestInit;expect(init.method).toBe('POST');expect(String(init.body)).toContain('grant_type=authorization_code');expect(init.redirect).toBe('error');expect(init.cache).toBe('no-store');});
it.each([{user_id:'other',account_type:'BUSINESS'},{user_id:'100',account_type:'PERSONAL'},{user_id:9007199254740992,account_type:'BUSINESS'}])('rejects unproven/mismatching professional identity',async proof=>{expect(await exchangeInstagramCode('code',binding,cfg,{fetch:transport(proof)})).toEqual({ok:false,code:'REJECTED'});});
it('missing required permission stops before token upgrade',async()=>{const http=vi.fn().mockResolvedValue(new Response(JSON.stringify({access_token:'synthetic',user_id:'100',permissions:['instagram_business_basic']})));expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'REJECTED'});expect(http).toHaveBeenCalledTimes(1);});
it('app/contract mismatch denies before dispatch',async()=>{const http=transport();expect(await exchangeInstagramCode('code',{...binding,appId:'other'},cfg,{fetch:http})).toEqual({ok:false,code:'REJECTED'});expect(http).not.toHaveBeenCalled();});
it('lost/malformed exchange response is unknown and never retries',async()=>{const http=vi.fn().mockRejectedValue(Error('synthetic transport detail'));expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'UNKNOWN'});expect(http).toHaveBeenCalledTimes(1);});
it('nonpositive or missing provider expiry cannot be guessed',async()=>{const http=transport();http.mockReset().mockResolvedValueOnce(new Response(JSON.stringify({access_token:'synthetic',user_id:'100',permissions:cfg.requiredPermissions}))).mockResolvedValueOnce(new Response(JSON.stringify({access_token:'synthetic-long',expires_in:0})));expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'UNKNOWN'});expect(http).toHaveBeenCalledTimes(2);});
it('requires production callback origin to match configured public site',async()=>{
 const {readInstagramOAuthConfig}=await import('./oauth-meta');
 const env={NODE_ENV:'production',INSTAGRAM_APP_ID:'1000',INSTAGRAM_APP_SECRET:'synthetic',INSTAGRAM_LOGIN_CONTRACT_ID:'test',INSTAGRAM_REDIRECT_URI:cfg.redirectUri,NEXT_PUBLIC_SITE_URL:'https://www.velorahelper.com'};
 expect(readInstagramOAuthConfig(env)).not.toBeNull();expect(readInstagramOAuthConfig({...env,NEXT_PUBLIC_SITE_URL:'https://other.invalid'})).toBeNull();expect(readInstagramOAuthConfig({...env,NEXT_PUBLIC_SITE_URL:undefined})).toBeNull();
 const approved={...env,INSTAGRAM_APP_ID:'1130181646406297',NEXT_PUBLIC_SITE_URL:'https://velorahelper.com'};
 expect(readInstagramOAuthConfig(approved)).not.toBeNull();
 for(const redirect of ['https://evil.velorahelper.com/api/instagram/oauth/callback','https://www.velorahelper.com/api/instagram/oauth/callback/','https://www.velorahelper.com/api/instagram/oauth/callback?next=x','http://www.velorahelper.com/api/instagram/oauth/callback'])expect(readInstagramOAuthConfig({...approved,INSTAGRAM_REDIRECT_URI:redirect})).toBeNull();
 expect(readInstagramOAuthConfig({...approved,INSTAGRAM_APP_ID:'1000'})).toBeNull();
});

it('unscoped company/owner/app cannot make any OAuth HTTP request',async()=>{f.scope.mockReturnValue(false);const http=transport();expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'REJECTED'});expect(http).not.toHaveBeenCalled();});
it('scope expiry after code exchange prevents upgrade and profile request',async()=>{const http=vi.fn().mockImplementationOnce(async()=>{f.scope.mockReturnValue(false);return new Response(JSON.stringify({access_token:'synthetic-short-token',user_id:'100',permissions:cfg.requiredPermissions}));});expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'UNKNOWN'});expect(http).toHaveBeenCalledTimes(1);});
it('uses documented reauthentication controls without the unsupported alias',()=>{
 const url=new URL(instagramAuthorizationUrl(cfg,'a'.repeat(64))!);
 expect(url.searchParams.get('force_reauth')).toBe('true');expect(url.searchParams.get('enable_fb_login')).toBe('false');expect(url.searchParams.has('force_authentication')).toBe(false);
});
it('accepts the documented single-account data envelope without weakening identity checks',async()=>{
 expect(await exchangeInstagramCode('code',binding,cfg,{fetch:transport({data:[{user_id:'100',username:'synthetic-business',account_type:'BUSINESS'}]})})).toMatchObject({ok:true,evidence:{accountId:'100'}});
});
it.each([{data:[]},{data:[{user_id:'100'},{user_id:'200'}]},{user_id:'100',data:[{user_id:'100',username:'synthetic-business',account_type:'BUSINESS'}]}])('rejects ambiguous account envelopes',async proof=>{
 expect(await exchangeInstagramCode('code',binding,cfg,{fetch:transport(proof)})).toEqual({ok:false,code:'REJECTED'});
});

it.each([{user_id:'100',username:'another_business',account_type:'BUSINESS'},{user_id:'100',account_type:'BUSINESS'}])('another or missing genuine username rejects before success evidence',async proof=>{const http=transport(proof);expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'REJECTED'});expect(f.profile).toHaveBeenCalledWith(binding.companyId,binding.userId,binding.appId,proof.username);});
it('matching genuine username keeps exact real numeric account evidence',async()=>{const result=await exchangeInstagramCode('code',binding,cfg,{fetch:transport()});expect(result).toMatchObject({ok:true,evidence:{accountId:'100'}});expect(f.profile).toHaveBeenCalledWith(binding.companyId,binding.userId,binding.appId,'synthetic-business');});
it('target permission revoked after genuine profile request still rejects',async()=>{f.profile.mockReturnValue(false);expect(await exchangeInstagramCode('code',binding,cfg,{fetch:transport()})).toEqual({ok:false,code:'REJECTED'});});

it('another genuine professional profile is rejected before Vault stage, subscription or finalization',async()=>{
 const stage=vi.fn(),subscribe=vi.fn(),finalize=vi.fn(),http=transport({user_id:'100',username:'other_business',account_type:'BUSINESS'});
 const result=await completeInstagramConnection({companyId:binding.companyId,userId:binding.userId,sessionId:binding.sessionId},
  {attemptId:binding.attemptId,state:'a'.repeat(64),code:'synthetic-code'},binding,{
   claim:async()=>({kind:'claimed' as const,committed:true as const,binding}),
   exchange:(code,ref)=>exchangeInstagramCode(code,ref,cfg,{fetch:http}),stage,subscribe,finalize,
   settleClaim:async()=>({kind:'rejected' as const,binding}),readProgress:async()=>({kind:'rejected' as const,binding})});
 expect(result).toEqual({ok:false,code:'CONSUMED'});expect(stage).not.toHaveBeenCalled();expect(subscribe).not.toHaveBeenCalled();expect(finalize).not.toHaveBeenCalled();
});

it('diagnostics emit only stage and sanitized code, never provider body or credentials',async()=>{
 const {afterEach}=await import('vitest');
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.stubEnv('NODE_ENV','production');
 try{
  const http=vi.fn().mockResolvedValue(new Response(JSON.stringify({error_type:'OAuthException',error_message:'private-code synthetic-app-secret synthetic-token'}),{status:400}));
  await exchangeInstagramCode('private-code',binding,cfg,{fetch:http});
  expect(log).toHaveBeenCalledWith(JSON.stringify({stage:'code_exchange',code:'OAUTH_HTTP_400'}));
  expect(log.mock.calls.flat().join('')).not.toMatch(/private-code|synthetic-app-secret|synthetic-token/);
 }finally{vi.unstubAllEnvs();log.mockRestore();}
});

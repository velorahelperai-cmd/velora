import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const f=vi.hoisted(()=>({config:vi.fn(),scope:vi.fn(),profile:vi.fn()}));vi.mock('./config',()=>({instagramConfig:f.config}));vi.mock('./connect-scope',()=>({instagramOwnerConnectScope:f.scope,instagramOwnerConnectProfile:f.profile}));
import {instagramAuthorizationUrl,exchangeInstagramCode} from './oauth-meta';
import {completeInstagramConnection} from './connection-flow';
const cfg={appId:'1000',appSecret:'synthetic-app-secret',contractId:'instagram-login-v26',redirectUri:'https://www.velorahelper.com/api/instagram/oauth/callback',requiredPermissions:['instagram_business_basic','instagram_business_manage_messages']};
const binding={companyId:'abcdefab-0000-4000-8000-000000000001',userId:'abcdefab-0000-4000-8000-000000000011',sessionId:'abcdefab-0000-4000-8000-000000000021',attemptId:'abcdefab-0000-4000-8000-000000000003',generation:1,appId:cfg.appId,contractId:cfg.contractId};
it('renewal can change its username while native stable-account pin remains authoritative',async()=>{const result=await exchangeInstagramCode('code',binding,cfg,{expectedAccountId:'100',fetch:transport({id:'100',user_id:'100',username:'renamed_business',account_type:'BUSINESS'})});expect(result).toMatchObject({ok:true,evidence:{accountId:'100',username:'renamed_business'}});expect(f.profile).not.toHaveBeenCalled();});
it('shares a fixed public failure diagnostic without changing the provider result or exposing body',async()=>{
 const onDiagnostic=vi.fn(),http=vi.fn().mockResolvedValue(new Response(JSON.stringify({error_type:'OAuthException',error_message:'private-code synthetic-app-secret'}),{status:400}));
 expect(await exchangeInstagramCode('private-code',binding,cfg,{fetch:http,onDiagnostic})).toEqual({ok:false,code:'REJECTED'});
 expect(onDiagnostic).toHaveBeenCalledWith({reference:expect.stringMatching(/^VEL-[A-F0-9]{16}$/),operation:'instagram_connect',stage:'code_exchange',code:'PROVIDER_REJECTED'});
 expect(JSON.stringify(onDiagnostic.mock.calls)).not.toMatch(/private-code|synthetic-app-secret/);
});
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(console,'info').mockImplementation(()=>{});f.scope.mockReturnValue(true);f.profile.mockImplementation((_company:string,_owner:string,_app:string,username:unknown)=>username==='synthetic-business');f.config.mockReturnValue({graphVersion:'v26.0',connectEnabled:true});});
function transport(change?:unknown){return vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({access_token:'synthetic-short-token',user_id:'100',permissions:cfg.requiredPermissions}))).mockResolvedValueOnce(new Response(JSON.stringify({access_token:'synthetic-long-token',expires_in:3600}))).mockResolvedValueOnce(new Response(JSON.stringify(change??{id:'100',user_id:'100',username:'synthetic-business',account_type:'BUSINESS'})));}
it('keeps authorize/code exchange closed before any HTTP',async()=>{f.config.mockReturnValue({graphVersion:'v26.0',connectEnabled:false});const http=transport();expect(instagramAuthorizationUrl(cfg,'a'.repeat(64))).toBeNull();expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'REJECTED'});expect(http).not.toHaveBeenCalled();});
it('authorize URL contains only public app/redirect/scopes and opaque state',()=>{const url=new URL(instagramAuthorizationUrl(cfg,'a'.repeat(64))!);expect(url.origin).toBe('https://www.instagram.com');expect(url.searchParams.get('response_type')).toBe('code');expect(url.searchParams.get('scope')).toBe(cfg.requiredPermissions.join(','));expect(url.href).not.toContain(cfg.appSecret);});
it('uses the identical redirect URI in authorization and multipart code exchange',async()=>{const state='a'.repeat(64),authorization=new URL(instagramAuthorizationUrl(cfg,state)!);expect(authorization.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);const http=transport();const result=await exchangeInstagramCode('synthetic-code',binding,cfg,{fetch:http});expect(result).toMatchObject({ok:true,accessToken:'synthetic-long-token',evidence:{appId:'1000',accountId:'100',permissions:cfg.requiredPermissions,contractId:cfg.contractId}});expect(http).toHaveBeenCalledTimes(3);expect(http.mock.calls[0][0]).toBe('https://api.instagram.com/oauth/access_token');const init=http.mock.calls[0][1] as RequestInit;expect(init.method).toBe('POST');expect(init.body).toBeInstanceOf(FormData);const form=init.body as FormData;expect(form.get('client_id')).toBe(cfg.appId);expect(form.get('client_secret')).toBe(cfg.appSecret);expect(form.get('grant_type')).toBe('authorization_code');expect(form.get('redirect_uri')).toBe(authorization.searchParams.get('redirect_uri'));expect(form.get('code')).toBe('synthetic-code');expect(init.headers).toBeUndefined();expect(init.redirect).toBe('error');expect(init.cache).toBe('no-store');});
it('preserves a provider numeric account ID beyond JavaScript safe-integer precision',async()=>{
 const id='17841400000000001';
 const raw='{"data":[{"access_token":"synthetic-short","user_id":'+id+',"permissions":"instagram_business_basic,instagram_business_manage_messages"}]}';
 const http=vi.fn().mockResolvedValueOnce(new Response(raw)).mockResolvedValueOnce(new Response(JSON.stringify({access_token:'synthetic-long',expires_in:3600}))).mockResolvedValueOnce(new Response(JSON.stringify({id,user_id:id,username:'synthetic-business',account_type:'BUSINESS'})));
 expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toMatchObject({ok:true,evidence:{accountId:id}});
});
it('binds the OAuth user to profile.id and persists the separate professional webhook user_id',async()=>{
 const http=transport({id:'100',user_id:'17841400000000001',username:'synthetic-business',account_type:'Business'});
 expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toMatchObject({ok:true,evidence:{accountId:'17841400000000001'}});
 expect(new URL(http.mock.calls[2][0]).searchParams.get('fields')).toBe('id,user_id,username,account_type');
});
it.each([
 {user_id:'17841400000000001',username:'synthetic-business',account_type:'BUSINESS'},
 {id:'200',user_id:'17841400000000001',username:'synthetic-business',account_type:'BUSINESS'},
 {id:'200',user_id:'100',username:'synthetic-business',account_type:'BUSINESS'},
 {id:'100',user_id:'invalid',username:'synthetic-business',account_type:'BUSINESS'},
])('rejects a missing or mismatched scoped identity independently of the professional ID',async proof=>{expect(await exchangeInstagramCode('code',binding,cfg,{fetch:transport(proof)})).toEqual({ok:false,code:'REJECTED'});});
it.each([{user_id:'other',account_type:'BUSINESS'},{user_id:'100',account_type:'PERSONAL'},{user_id:9007199254740992,account_type:'BUSINESS'}])('rejects unproven/mismatching professional identity',async proof=>{expect(await exchangeInstagramCode('code',binding,cfg,{fetch:transport(proof)})).toEqual({ok:false,code:'REJECTED'});});
it('missing required permission stops before token upgrade',async()=>{const http=vi.fn().mockResolvedValue(new Response(JSON.stringify({access_token:'synthetic',user_id:'100',permissions:['instagram_business_basic']})));expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'REJECTED'});expect(http).toHaveBeenCalledTimes(1);});
it.each([
 [{access_token:'synthetic',user_id:'100'},'PERMISSIONS_RESPONSE_UNPROVEN'],
 [{access_token:'synthetic',user_id:'100',permissions:['instagram_business_basic']},'REQUIRED_PERMISSION_NOT_GRANTED'],
 [{access_token:'synthetic',user_id:null,permissions:cfg.requiredPermissions},'ACCOUNT_ID_UNPROVEN'],
])('diagnoses unproven grants without logging token or identifiers',async(body,code)=>{
 vi.stubEnv('NODE_ENV','production');const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 try{await exchangeInstagramCode('code',binding,cfg,{fetch:vi.fn().mockResolvedValue(new Response(JSON.stringify(body)))});expect(log.mock.calls.map(([v])=>JSON.parse(String(v)))).toContainEqual(expect.objectContaining({stage:'granted_permissions',code}));expect(log.mock.calls.flat().join('')).not.toMatch(/synthetic|9007199254740992/);}finally{vi.unstubAllEnvs();}
});
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
 expect(await exchangeInstagramCode('code',binding,cfg,{fetch:transport({data:[{id:'100',user_id:'100',username:'synthetic-business',account_type:'BUSINESS'}]})})).toMatchObject({ok:true,evidence:{accountId:'100'}});
});
it.each([{data:[]},{data:[{user_id:'100'},{user_id:'200'}]},{user_id:'100',data:[{user_id:'100',username:'synthetic-business',account_type:'BUSINESS'}]}])('rejects ambiguous account envelopes',async proof=>{
 expect(await exchangeInstagramCode('code',binding,cfg,{fetch:transport(proof)})).toEqual({ok:false,code:'REJECTED'});
});

it.each([{id:'100',user_id:'100',username:'another_business',account_type:'BUSINESS'},{id:'100',user_id:'100',account_type:'BUSINESS'}])('another or missing genuine username rejects before success evidence',async proof=>{const http=transport(proof);expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'REJECTED'});expect(f.profile).toHaveBeenCalledWith(binding.companyId,binding.userId,binding.appId,proof.username);});
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
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.stubEnv('NODE_ENV','production');
 try{
  const http=vi.fn().mockResolvedValue(new Response(JSON.stringify({error_type:'OAuthException',error_message:'private-code synthetic-app-secret synthetic-token'}),{status:400}));
  await exchangeInstagramCode('private-code',binding,cfg,{fetch:http});
  const event=log.mock.calls.map(([value])=>JSON.parse(String(value))).find(row=>row.code==='OAUTH_HTTP_400');expect(event).toMatchObject({reference:expect.stringMatching(/^VEL-[A-F0-9]{16}$/),operation:'instagram_connect',stage:'code_exchange',code:'OAUTH_HTTP_400'});
  expect(log.mock.calls.flat().join('')).not.toMatch(/private-code|synthetic-app-secret|synthetic-token/);
 }finally{vi.unstubAllEnvs();log.mockRestore();}
});

it.each([
 ['Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request.','REDIRECT_URI_REJECTED'],
 ['This authorization code has been used.','AUTHORIZATION_CODE_USED'],
 ['Authorization code has expired.','AUTHORIZATION_CODE_EXPIRED'],
 ['Invalid platform app.','APP_CREDENTIALS_REJECTED'],
])('diagnoses a recognized OAuth error using fixed reasons only: %s',async(message,reason)=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.stubEnv('NODE_ENV','production');
 try{
  const http=vi.fn().mockResolvedValue(new Response(JSON.stringify({error_type:'OAuthException',error_message:message+' synthetic-app-secret private-code private-state synthetic-token'}),{status:400}));
  expect(await exchangeInstagramCode('private-code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'REJECTED'});
  expect(http).toHaveBeenCalledTimes(1);
  const event=log.mock.calls.map(([value])=>JSON.parse(String(value))).find(row=>row.code==='OAUTH_HTTP_400');expect(event).toMatchObject({reference:expect.stringMatching(/^VEL-[A-F0-9]{16}$/),operation:'instagram_connect',stage:'code_exchange',code:'OAUTH_HTTP_400',reason});
  expect(log.mock.calls.flat().join('')).not.toMatch(/synthetic-app-secret|private-code|private-state|synthetic-token/);
 }finally{vi.unstubAllEnvs();log.mockRestore();}
});

it('does not guess a diagnostic reason for an unfamiliar OAuth error',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.stubEnv('NODE_ENV','production');
 try{
  const http=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{type:'OAuthException',message:'private unrecognized response',code:'private-code'}}),{status:400}));
  expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'REJECTED'});
  const event=log.mock.calls.map(([value])=>JSON.parse(String(value))).find(row=>row.code==='OAUTH_HTTP_400');expect(event).toMatchObject({reference:expect.stringMatching(/^VEL-[A-F0-9]{16}$/),operation:'instagram_connect',stage:'code_exchange',code:'OAUTH_HTTP_400'});
 }finally{vi.unstubAllEnvs();log.mockRestore();}
});

it('recognizes a nested OAuth error without logging provider metadata or text',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.stubEnv('NODE_ENV','production');
 try{
  const http=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{type:'OAuthException',message:'Invalid client_secret. synthetic-app-secret',code:190,error_subcode:999,fbtrace_id:'private-trace'}}),{status:400}));
  expect(await exchangeInstagramCode('code',binding,cfg,{fetch:http})).toEqual({ok:false,code:'REJECTED'});
  const event=log.mock.calls.map(([value])=>JSON.parse(String(value))).find(row=>row.code==='OAUTH_HTTP_400');expect(event).toMatchObject({reference:expect.stringMatching(/^VEL-[A-F0-9]{16}$/),operation:'instagram_connect',stage:'code_exchange',code:'OAUTH_HTTP_400',reason:'APP_CREDENTIALS_REJECTED',providerCode:190,providerSubcode:999});
 }finally{vi.unstubAllEnvs();log.mockRestore();}
});

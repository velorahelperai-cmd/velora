import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {instagramOwnerConnectScope as permit,instagramOwnerConnectProfile as profile} from './connect-scope';
const now=Date.parse('2026-10-13T00:00:00.000Z');
const scope={companyId:'7c5e429d-2be3-4578-bf15-8db2fdb5647f',ownerId:'5e6d6d79-c601-4968-a764-5cddc1ac4303',appId:'1130181646406297',expectedUsername:'velorahelperai',validFrom:'2026-10-13T00:00:00.000Z',expiresAt:'2026-10-15T00:00:00.000Z'};
const env=(s:unknown)=>({INSTAGRAM_CONNECT_SCOPES:JSON.stringify(s)});
const allowed=(s:unknown,n=now)=>permit(scope.companyId,scope.ownerId,scope.appId,env(s),n);
it('exact registered native owner/company/app is allowed within 48 hours',()=>expect(allowed([scope])).toBe(true));
it('missing or malformed config fails closed',()=>{for(const raw of [undefined,'true','[]','null','{','x'.repeat(16385)])expect(permit(scope.companyId,scope.ownerId,scope.appId,{INSTAGRAM_CONNECT_SCOPES:raw},now)).toBe(false);});
it.each(['companyId','ownerId','appId'])('another %s cannot use the registered permit',key=>expect(allowed([{...scope,[key]:key==='appId'?'3391832644330595':'abcdefab-0000-4000-8000-000000000009'}])).toBe(false));
it('not yet valid and exact expiry fail closed',()=>{expect(allowed([scope],now-1)).toBe(false);expect(allowed([scope],now+48*3600000)).toBe(false);});
it('more than 48 hours, reversed dates, offset timestamps and invalid dates fail closed',()=>{for(const expiresAt of ['2026-10-15T00:00:00.001Z','2026-10-12T00:00:00.000Z','2026-10-15T04:00:00+04:00','invalid'])expect(allowed([{...scope,expiresAt}])).toBe(false);});
it('duplicate matching entries fail closed',()=>expect(allowed([scope,scope])).toBe(false));
it('extra fields and invalid unrelated entries fail the complete config',()=>{expect(allowed([{...scope,enabled:true}])).toBe(false);expect(allowed([scope,{companyId:'bad'}])).toBe(false);});
it('NaN clock and noncanonical identity fail closed',()=>{expect(allowed([scope],NaN)).toBe(false);expect(permit(scope.companyId.toUpperCase(),scope.ownerId,scope.appId,env([scope]),now)).toBe(false);});

it('required expectedUsername accepts only a bounded canonical username',()=>{for(const expectedUsername of [undefined,'','@velorahelperai','velora helperai','VeloraHelperAI','x'.repeat(31),42])expect(allowed([{...scope,expectedUsername}])).toBe(false);});
it('genuine returned username must match the configured target',()=>{expect(profile(scope.companyId,scope.ownerId,scope.appId,'velorahelperai',env([scope]),now)).toBe(true);expect(profile(scope.companyId,scope.ownerId,scope.appId,'VeloraHelperAI',env([scope]),now)).toBe(true);for(const username of [undefined,null,'other_account','@velorahelperai','velorahelperai ',42])expect(profile(scope.companyId,scope.ownerId,scope.appId,username,env([scope]),now)).toBe(false);});
it('matching username cannot bypass owner, app or expiry',()=>{expect(profile(scope.companyId,'abcdefab-0000-4000-8000-000000000009',scope.appId,'velorahelperai',env([scope]),now)).toBe(false);expect(profile(scope.companyId,scope.ownerId,'3391832644330595','velorahelperai',env([scope]),now)).toBe(false);expect(profile(scope.companyId,scope.ownerId,scope.appId,'velorahelperai',env([scope]),now+48*3600000)).toBe(false);});

import {describe,expect,it} from 'vitest';
import {setupEntryDecision,setupLayoutDecision,setupDecisionHref} from './setup-entry-decision';
import type {CompanyContext} from './types';
const context:CompanyContext={userId:'actor',email:'actor@example.test',phone:'',fullName:'Actor',supportCode:'',needsProfileName:false,emailConfirmed:true,identityVerified:true,isPlatformAdmin:false,company:null,membership:null,needsCompanyContext:false,workspaceChoices:[]};
const decide=(patch:Partial<CompanyContext>={})=>setupEntryDecision({ok:true,context:{...context,...patch}});
describe('setup decision from native account access',()=>{
 it.each(['FORBIDDEN','UNAVAILABLE'] as const)('preserves %s without granting setup',code=>expect(setupEntryDecision({ok:false,code})).toEqual({kind:'deny',code}));
 it.each([['UNAUTHENTICATED','login'],['UNVERIFIED','verify-email']] as const)('preserves %s recovery', (code,target)=>expect(setupEntryDecision({ok:false,code})).toEqual({kind:'redirect',target}));
 it('requires profile completion before resolving a company',()=>expect(decide({needsProfileName:true,needsCompanyContext:true})).toEqual({kind:'redirect',target:'complete-profile'}));
 it('requires explicit workspace choice before admin routing',()=>expect(decide({isPlatformAdmin:true,needsCompanyContext:true})).toEqual({kind:'redirect',target:'workspace'}));
 it('routes unselected platform admins to administration',()=>expect(decide({isPlatformAdmin:true})).toEqual({kind:'redirect',target:'admin'}));
 it('keeps staff out of owner setup even with a selected company',()=>expect(decide({membership:{role:'staff'} as CompanyContext['membership'],company:{id:'company'} as CompanyContext['company']})).toEqual({kind:'redirect',target:'conversations'}));
 it('admits selected owner companies with only the required identifiers',()=>expect(decide({isPlatformAdmin:true,membership:{role:'owner'} as CompanyContext['membership'],company:{id:'company'} as CompanyContext['company']})).toEqual({kind:'company',userId:'actor',companyId:'company'}));
 it('retains unpaid eligibility for a new account',()=>expect(decide()).toEqual({kind:'prepare',userId:'actor'}));
 it('rejects membership-only accounts but retains native owner evidence',()=>{
  expect(decide({hasBusinessMemberships:true})).toEqual({kind:'deny',code:'FORBIDDEN'});
  expect(decide({hasBusinessMemberships:true,ownedBusinessCount:1})).toEqual({kind:'prepare',userId:'actor'});
 });
 it('does not add unpaid-draft restrictions to child-route layout policy',()=>expect(setupLayoutDecision({ok:true,context:{...context,hasBusinessMemberships:true}})).toBeNull());
 it('retains encoded setup selection through recovery',()=>{
  const path='/setup?next=%2Fapp%2Fsettings%3Ftab%3Dplan';
  expect(new URL(setupDecisionHref('login',path),'https://example.test').searchParams.get('next')).toBe(path);
  expect(setupDecisionHref('workspace',path)).toBe(`/app?next=${encodeURIComponent(path)}`);
 });
});

import {expect,it} from 'vitest';
import {canUseQaSetupSimulation} from './qa-setup-simulation';
import type {CompanyContext} from './types';
const context={userId:'83ad69f7-cbb0-4e3a-a34e-8085e5203dc7',email:'velorahelperai+meta-review@gmail.com',emailConfirmed:true,identityVerified:true,company:null,membership:null,needsCompanyContext:false,workspaceChoices:[]} as unknown as CompanyContext;
it('permits only the confirmed isolated QA identity',()=>{expect(canUseQaSetupSimulation(context)).toBe(true);});
it.each([{userId:'another-user'},{email:'other@example.invalid'},{emailConfirmed:false},{identityVerified:false},{hasBranchMemberships:true},{hasBusinessMemberships:true},{ownedBusinessCount:1},{needsCompanyContext:true},{workspaceChoices:[{companyId:'other'}]},{company:{id:'other'}}])('rejects another identity, unconfirmed account or company binding %#',patch=>{expect(canUseQaSetupSimulation({...context,...patch} as CompanyContext)).toBe(false);});

import {expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({read:vi.fn(()=>{throw new Error('unpaid draft must not be read');}),access:vi.fn(()=>{throw new Error('public document must not read private account');})}));
vi.mock('next/headers',()=>({headers:async()=>new Headers()}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:f.access}));
vi.mock('@/lib/tenancy/setup-draft-actions',()=>({readSetupFileContext:f.read}));
vi.mock('@/components/app/setup-account-entry',()=>({SetupAccountEntry:()=>null}));
import Page from './page';
import {SetupAccountEntry} from '@/components/app/setup-account-entry';
it('serves public preparation entry before any private account or draft read',async()=>{
 const result=await Page();
 expect(result.type).toBe(SetupAccountEntry);
 expect(result.props).toEqual({returnTo:'/setup',preferredNext:''});
 expect(f.read).not.toHaveBeenCalled();expect(f.access).not.toHaveBeenCalled();
});

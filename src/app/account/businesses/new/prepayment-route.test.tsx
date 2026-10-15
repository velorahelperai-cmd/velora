import {expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({read:vi.fn(()=>{throw new Error('new preparation cannot restore server drafts');})}));
vi.mock('@/lib/master-journey/rollout',()=>({masterJourneyEnabled:()=>true}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:async()=>({ok:true,context:{userId:'fixture',company:null,workspaceChoices:[]}})}));
vi.mock('@/lib/tenancy/setup-draft-actions',()=>({readActiveSetupDraft:f.read}));
vi.mock('@/lib/tenancy/personal-phone-actions',()=>({getPersonalPhoneStatus:vi.fn()}));
import Page from './page';
import {PrepaymentPreparation} from '@/components/app/prepayment-preparation';
it('uses local preparation for new-business entry without draft recovery or company creation',async()=>{const result=await Page();expect(result.type).toBe(PrepaymentPreparation);expect(f.read).not.toHaveBeenCalled();});

import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({read:vi.fn(),broker:vi.fn(),company:vi.fn()}));
vi.mock('@/lib/customer/service-inbox-actions',()=>({readServiceInbox:m.read}));
vi.mock('@/lib/supabase/server',()=>({runWithVerifiedReadClient:m.broker}));
vi.mock('@/lib/tenancy/access',()=>({runWithVerifiedCompanyRead:m.company}));
vi.mock('@/components/app/unified-inbox',()=>({UnifiedInbox:()=>null}));
vi.mock('@/lib/instagram/config',()=>({instagramReviewMode:()=>false}));
vi.mock('@/lib/whatsapp/config',()=>({whatsappConfigurationMode:()=>null,whatsappConfig:()=>({})}));
import Page from './page';
beforeEach(()=>{vi.resetAllMocks();m.read.mockResolvedValue({ok:true,actorId:'actor',companyId:'company'});m.company.mockImplementation(work=>work());m.broker.mockImplementation(async work=>({value:await work(),actorId:'actor'}));});
async function renderContent(){const page=Page();return page.props.children.type();}
it('renders one read through both existing fences',async()=>{
 const content=await renderContent();expect(content.props.initial).toMatchObject({ok:true,actorId:'actor'});
 expect(m.read).toHaveBeenCalledOnce();expect(m.company).toHaveBeenCalledOnce();expect(m.broker).toHaveBeenCalledOnce();
});
it('discards rows when the final broker fence fails',async()=>{
 m.broker.mockImplementation(async work=>{await work();throw Error('changed');});
 expect((await renderContent()).props.initial).toEqual({ok:false,code:'UNAVAILABLE'});
});
it('rejects a payload actor different from the verified broker',async()=>{
 m.read.mockResolvedValue({ok:true,actorId:'other',companyId:'company'});
 expect((await renderContent()).props.initial).toEqual({ok:false,code:'SCOPE_CHANGED'});
});

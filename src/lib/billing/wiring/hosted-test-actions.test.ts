import {afterEach,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({access:vi.fn(),order:vi.fn(),settings:vi.fn(),admin:vi.fn()}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:s.access}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:s.admin}));
vi.mock('./order-actions',()=>({createBillingOrderAction:s.order}));
vi.mock('./test-checkout',()=>({readTestCheckoutConfig:s.settings,openTestCheckout:vi.fn(),fetchPaymobHttp:{}}));
vi.mock('@/lib/auth/site-url',()=>({siteUrl:()=> 'https://www.velorahelper.com'}));
import {startTestCheckoutAction,resumeTestCheckoutAction} from './test-checkout-actions';
const account='11111111-1111-4111-8111-111111111111',company='22222222-2222-4222-8222-222222222222';
function configure(){vi.clearAllMocks();s.access.mockResolvedValue({ok:true,context:{userId:account,company:{id:company,status:'active',contact_phone:'+96890000000'},membership:{role:'owner'}}});s.settings.mockReturnValue({ok:true,unitsPerOmr:1000,config:{integrationId:71610}});s.order.mockResolvedValue({ok:false,code:'plan_not_published'});}
afterEach(()=>vi.unstubAllEnvs());
it('default off refuses Test start and resume before settings, DB or provider',async()=>{configure();vi.stubEnv('BILLING_PAYMOB_HOSTED_TEST_ENABLED','');expect(await startTestCheckoutAction({planVersionId:'version',clientOpId:'operation'})).toMatchObject({ok:false,code:'hosted_test_not_authorized'});expect(await resumeTestCheckoutAction({orderId:'order'})).toMatchObject({ok:false,code:'hosted_test_not_authorized'});expect(s.settings).not.toHaveBeenCalled();expect(s.order).not.toHaveBeenCalled();expect(s.admin).not.toHaveBeenCalled()});
it('client Test/account claims cannot override configured actor boundary',async()=>{configure();vi.stubEnv('BILLING_PAYMOB_HOSTED_TEST_ENABLED','true');vi.stubEnv('PAYMOB_HOSTED_TEST_ACCOUNT_ID','33333333-3333-4333-8333-333333333333');vi.stubEnv('PAYMOB_HOSTED_TEST_COMPANY_ID',company);expect(await startTestCheckoutAction({planVersionId:'version',clientOpId:'operation',test:true,accountId:account} as never)).toMatchObject({ok:false,code:'hosted_test_not_authorized'});expect(s.order).not.toHaveBeenCalled()});
it('explicit matching server pair reaches normal canonical order checks',async()=>{configure();vi.stubEnv('BILLING_PAYMOB_HOSTED_TEST_ENABLED','true');vi.stubEnv('PAYMOB_HOSTED_TEST_ACCOUNT_ID',account);vi.stubEnv('PAYMOB_HOSTED_TEST_COMPANY_ID',company);expect(await startTestCheckoutAction({planVersionId:'version',clientOpId:'operation'})).toMatchObject({ok:false,code:'plan_not_published'})});

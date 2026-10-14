import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('@/lib/billing/autorenew-wallet-actions',()=>({readRenewalWalletAction:vi.fn(),requestExcessRefundAction:vi.fn(),setAutoRenewAction:vi.fn()}));
vi.mock('./account-chrome',()=>({useOptionalAccountSession:()=>null}));
import {BusinessFinancialRightsView,financialRightsSnapshot} from './business-financial-rights-panel';
const company='11111111-1111-4111-8111-111111111111';
const receipt={companyId:company,wallet:{balanceBaisa:45000,currency:'OMR',frozen:false},excessCollections:[{id:'22222222-2222-4222-8222-222222222222',amountBaisa:45000,currency:'OMR',state:'converted'}],autoRenew:{requested:true,enabled:true}};
it('preserves refund-review access after conversion and exposes only stop for automatic renewal',()=>{
 const data=financialRightsSnapshot(receipt,company);expect(data).not.toBeNull();
 const html=renderToStaticMarkup(<BusinessFinancialRightsView data={data!} ar={false} pending={false} onRefund={()=>{}} onStop={()=>{}}/>);
 expect(html).toContain('Request refund review');expect(html).toContain('Stop automatic renewal');expect(html).toContain('review request');expect(html).not.toContain('Convert to');expect(html).not.toContain('Renew from');expect(html).not.toContain('Enable automatic');
});
it('rejects receipts for another business or malformed financial amounts',()=>{
 expect(financialRightsSnapshot(receipt,'other')).toBeNull();expect(financialRightsSnapshot({...receipt,wallet:{...receipt.wallet,balanceBaisa:-1}},company)).toBeNull();expect(financialRightsSnapshot({...receipt,excessCollections:[{...receipt.excessCollections[0],amountBaisa:'45000'}]},company)).toBeNull();
});
it('a recorded refund review is displayed without offering another request',()=>{
 const data=financialRightsSnapshot({...receipt,excessCollections:[{...receipt.excessCollections[0],state:'REFUND_REVIEW_REQUIRED'}],autoRenew:{requested:false,enabled:false}},company)!;
 const html=renderToStaticMarkup(<BusinessFinancialRightsView data={data} ar={false} pending={false} onRefund={()=>{}} onStop={()=>{}}/>);expect(html).toContain('Refund review requested');expect(html).not.toContain('Request refund review');expect(html).not.toContain('Stop automatic renewal');
});

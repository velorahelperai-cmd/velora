import {describe,expect,it} from 'vitest';
import {classifyCheckoutPreparationRetention as classify,type CheckoutRetentionInput} from './checkout-preparation-retention';

const base:CheckoutRetentionInput={checkoutState:'prepared',orderStatus:'open',paidAt:null,settlementApplied:false,provisionedCompanyId:null};
describe('non-destructive checkout preparation retention',()=>{
 it.each(['prepared','claimed','ready'])('holds %s even when a payment session has expired',checkoutState=>{
  expect(classify({...base,checkoutState})).toBe('hold_unpaid');
 });
 it('holds a verified paid order until provisioning succeeds',()=>{
  expect(classify({...base,checkoutState:'paid',orderStatus:'settled',paidAt:'2026-10-29T00:00:00Z',settlementApplied:true})).toBe('hold_paid_unprovisioned');
 });
 it('holds provisioned orders while financial and legal obligations are unproven',()=>{
  expect(classify({...base,checkoutState:'paid',orderStatus:'provisioned',paidAt:'2026-10-29T00:00:00Z',settlementApplied:true,provisionedCompanyId:'synthetic'})).toBe('hold_provisioned_obligations_unknown');
 });
 it.each([
  {checkoutState:'paid'},
  {checkoutState:'ready',settlementApplied:true},
  {checkoutState:'paid',orderStatus:'provisioned',paidAt:'invalid',settlementApplied:true,provisionedCompanyId:'synthetic'},
  {checkoutState:'paid',orderStatus:'provisioned',paidAt:'2026-10-29T00:00:00Z',settlementApplied:null,provisionedCompanyId:'synthetic'},
  {checkoutState:'paid',orderStatus:'provisioned',paidAt:'2026-10-29T00:00:00Z',settlementApplied:true},
 ] satisfies Partial<CheckoutRetentionInput>[])('holds inconsistent or incomplete evidence %#',values=>{
  expect(classify({...base,...values})).toBe('hold_unknown');
 });
});

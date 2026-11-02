import {describe,it,expect} from 'vitest';
import {nativeReplyBalance} from './dashboard-es02-credit-model';
const company='11111111-1111-4111-8111-111111111111';
const valid={company_id:company,granted:1000,remaining:999,held:0,paid_through:'2030-01-01T00:00:00Z'};
describe('native reply balance display',()=>{
 it('uses owner-scoped confirmed values',()=>expect(nativeReplyBalance(company,valid)).toEqual({granted:1000,remaining:999,held:0,paidThrough:'2030-01-01T00:00:00Z'}));
 it('rejects other companies',()=>expect(nativeReplyBalance('22222222-2222-4222-8222-222222222222',valid)).toBeNull());
 it.each([{...valid,remaining:-1},{...valid,remaining:1001},{...valid,held:1000},{...valid,granted:1.5},{...valid,paid_through:'bad'}])('does not display inconsistent values %#',data=>expect(nativeReplyBalance(company,data)).toBeNull());
});

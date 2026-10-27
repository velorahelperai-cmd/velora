import {expect,it} from 'vitest';
import {paidSetupActivation} from './paid-setup-activation';
const row={companyId:'company',orderGroupId:'order',clockState:'waiting_readiness',termUnit:'month',subscriptionStartedAt:null,paidThroughAt:null};
it('exposes an explicit unstarted server clock only for its exact company/order',()=>{expect(paidSetupActivation(row,'company','order')).toEqual(row);expect(paidSetupActivation(row,'other','order')).toBeNull();expect(paidSetupActivation(row,'company','other')).toBeNull();});
it.each([null,{}, {...row,clockState:'ready'},{...row,subscriptionStartedAt:'2026-10-27T00:00:00Z'},{...row,termUnit:'day'},{...row,clockState:'active'},{...row,clockState:'active',subscriptionStartedAt:'bad',paidThroughAt:'bad'}])('keeps missing or inconsistent activation unknown %#',value=>{expect(paidSetupActivation(value,'company','order')).toBeNull();});
it('retains actual active timestamps without deriving them from launch completion',()=>{const active={...row,clockState:'active',subscriptionStartedAt:'2026-10-27T00:00:00Z',paidThroughAt:'2026-11-27T00:00:00Z'};expect(paidSetupActivation(active,'company','order')?.clockState).toBe('active');});

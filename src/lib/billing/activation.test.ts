import {expect,it} from 'vitest';
import {parseActivationState} from './activation';
const value={companyId:'company',state:'waiting',paymentConfirmedAt:'2026-10-14T00:00:00Z',entitlementCreatedAt:'2026-10-14T00:00:01Z',activationDeadline:'2026-10-28T00:00:00Z',subscriptionStartedAt:null,expiresAt:null,operationalReady:false,bonusDays:7,paused:false,legacy:false};
it('preserves independently confirmed payment and waiting operational state',()=>{expect(parseActivationState(value,'company')).toEqual(value);});
it('rejects another company and fabricated active state without start/expiry',()=>{expect(parseActivationState(value,'other')).toBeNull();expect(parseActivationState({...value,state:'active'},'company')).toBeNull();});
it('deadline-started subscription may remain operationally unavailable',()=>{expect(parseActivationState({...value,state:'active',subscriptionStartedAt:value.activationDeadline,expiresAt:'2026-12-04T00:00:00Z'},'company')?.operationalReady).toBe(false);});

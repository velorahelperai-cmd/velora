import {afterEach,expect,it,vi} from 'vitest';
import {bindPaymobCorrelation,resolvePaymobCorrelationId} from './intention';
afterEach(()=>vi.useRealTimers());
it('evicts correlation bindings beyond bounded capacity',()=>{bindPaymobCorrelation({correlationId:'bounded-first',providerOrderId:'bounded-first-id'});for(let i=0;i<520;i++)bindPaymobCorrelation({correlationId:'bounded-'+i,providerOrderId:'bounded-id-'+i});expect(resolvePaymobCorrelationId({providerOrderId:'bounded-first-id'})).not.toBe('bounded-first')});
it('expires correlation bindings rather than retaining them for process lifetime',()=>{vi.useFakeTimers();vi.setSystemTime(0);bindPaymobCorrelation({correlationId:'expiring-correlation',providerOrderId:'expiring-id'});vi.advanceTimersByTime(16*60*1000);expect(resolvePaymobCorrelationId({providerOrderId:'expiring-id'})).not.toBe('expiring-correlation')});

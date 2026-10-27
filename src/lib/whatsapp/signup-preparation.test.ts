import {expect,it,vi,afterEach} from 'vitest';
vi.mock('server-only',()=>({}));
import {sealSignupPreparation,openSignupPreparation} from './signup-preparation';
const binding={accountId:'actor',sessionId:'session',companyId:'company',branchId:'branch',attemptId:'attempt',generation:1,nonce:'nonce',wabaId:'222',phoneNumberId:'333'};
afterEach(()=>vi.useRealTimers());
it('encrypts the token and binds the continuation to every identity and asset',()=>{const ticket=sealSignupPreparation('server-secret',binding,'private-access-token');expect(ticket).not.toContain('private-access-token');expect(openSignupPreparation('server-secret',ticket,binding)).toBe('private-access-token');for(const key of Object.keys(binding))expect(openSignupPreparation('server-secret',ticket,{...binding,[key]:'other'})).toBeNull();expect(openSignupPreparation('different-secret',ticket,binding)).toBeNull();expect(openSignupPreparation('server-secret',ticket.slice(0,-8)+'changed',binding)).toBeNull();});
it('expires the continuation after five minutes',()=>{vi.useFakeTimers();const ticket=sealSignupPreparation('secret',binding,'token');vi.advanceTimersByTime(300_001);expect(openSignupPreparation('secret',ticket,binding)).toBeNull();});

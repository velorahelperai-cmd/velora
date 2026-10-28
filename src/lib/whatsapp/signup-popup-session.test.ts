import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createSignupPopupSession} from './signup-popup-session';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
function fixture(){const trace=vi.fn(),onObservation=vi.fn();let current=true;const expiresAt=Date.now()+600000;const session=createSignupPopupSession({expiresAt,isCurrent:()=>current,trace,onObservation});return {session,trace,onObservation,lose:()=>{current=false;}};}
it.each(['code','assets'] as const)('accepts late %s after soft timeout, once, without changing expiry',async first=>{
 const {session,onObservation}=fixture();let count=0;void session.promise.then(()=>count++);
 if(first==='code')session.code('secret');else session.assets({wabaId:'12',phoneNumberId:'34'});
 await vi.advanceTimersByTimeAsync(300001);expect(count).toBe(0);expect(onObservation).toHaveBeenCalledWith('waiting_timeout');
 if(first==='code')session.assets({wabaId:'12',phoneNumberId:'34'});else session.code('secret');
 expect(await session.promise).toEqual({kind:'completed',code:'secret',wabaId:'12',phoneNumberId:'34'});session.code('duplicate');await Promise.resolve();expect(count).toBe(1);expect(vi.getTimerCount()).toBe(0);
});
it.each(['code','assets','none'] as const)('expires %s-only without success or cancellation',async kind=>{
 const {session,trace}=fixture();if(kind==='code')session.code('secret');if(kind==='assets')session.assets({wabaId:'12',phoneNumberId:'34'});
 await vi.advanceTimersByTimeAsync(600000);expect(await session.promise).toEqual({kind:'error'});session.code('late');session.assets({wabaId:'12',phoneNumberId:'34'});expect(JSON.stringify(trace.mock.calls)).not.toContain('secret');expect(vi.getTimerCount()).toBe(0);
});
it('rejects completion immediately after identity changes, before the poll',async()=>{const {session,lose}=fixture();session.code('secret');lose();session.assets({wabaId:'12',phoneNumberId:'34'});expect(await session.promise).toEqual({kind:'error'});});
it('treats observed popup close separately and still accepts already in-flight signals',async()=>{const {session,onObservation}=fixture();session.closed();expect(onObservation).toHaveBeenCalledWith('popup_closed');session.code('secret');session.assets({wabaId:'12',phoneNumberId:'34'});expect((await session.promise).kind).toBe('completed');});
it('does not equate missing callback code with cancellation',async()=>{const {session}=fixture();session.code(undefined);session.code('secret');session.assets({wabaId:'12',phoneNumberId:'34'});expect((await session.promise).kind).toBe('completed');});
it('rejects conflicting duplicates without replacing first evidence',async()=>{const {session}=fixture();session.code('one');session.code('two');expect(await session.promise).toEqual({kind:'error'});});
it('does not combine signals across concurrent captures',async()=>{const a=fixture(),b=fixture();a.session.code('a');b.session.assets({wabaId:'12',phoneNumberId:'34'});a.lose();await vi.advanceTimersByTimeAsync(500);expect(await a.session.promise).toEqual({kind:'error'});b.session.code('b');expect(await b.session.promise).toMatchObject({kind:'completed',code:'b'});});
it('does not turn CANCEL after partial completion into cancellation authority',async()=>{const {session}=fixture();session.assets({wabaId:'12',phoneNumberId:'34'});session.cancelled();expect(await session.promise).toEqual({kind:'error'});});

it.each(['code','assets'] as const)('persists early code independent of FINISH order %s and completes only after durable save',async first=>{
 let saved!:(ok:boolean)=>void;const onCode=vi.fn(()=>new Promise<boolean>(r=>{saved=r;}));const session=createSignupPopupSession({expiresAt:Date.now()+600000,isCurrent:()=>true,trace:vi.fn(),onCode});let done=false;void session.promise.then(()=>{done=true;});
 if(first==='code')session.code('secret');else session.assets({wabaId:'12',phoneNumberId:'34'});
 await Promise.resolve();if(first==='code')expect(onCode).toHaveBeenCalledTimes(1);else expect(onCode).not.toHaveBeenCalled();
 if(first==='code')session.assets({wabaId:'12',phoneNumberId:'34'});else session.code('secret');await Promise.resolve();session.code('secret');expect(onCode).toHaveBeenCalledTimes(1);expect(done).toBe(false);saved(true);expect(await session.promise).toEqual({kind:'completed',code:'early-authorization',wabaId:'12',phoneNumberId:'34'});
});
it('retains missing FINISH as unknown after saving, without exchanging again',async()=>{const onCode=vi.fn(async()=>true);const session=createSignupPopupSession({expiresAt:Date.now()+1000,isCurrent:()=>true,trace:vi.fn(),onCode});session.code('secret');await vi.advanceTimersByTimeAsync(1001);expect(await session.promise).toEqual({kind:'error'});expect(onCode).toHaveBeenCalledTimes(1);});
it.each(['expiry','identity'] as const)('does not accept delayed durable-save result after %s',async kind=>{let current=true,save!:(v:boolean)=>void;const session=createSignupPopupSession({expiresAt:Date.now()+1000,isCurrent:()=>current,trace:vi.fn(),onCode:()=>new Promise(r=>{save=r;})});session.code('secret');session.assets({wabaId:'12',phoneNumberId:'34'});await Promise.resolve();if(kind==='identity')current=false;else await vi.advanceTimersByTimeAsync(1001);save(true);expect(await session.promise).toEqual({kind:'error'});});
it.each([false,'throw'] as const)('keeps storage failure unknown %s',async value=>{const session=createSignupPopupSession({expiresAt:Date.now()+1000,isCurrent:()=>true,trace:vi.fn(),onCode:()=>{if(value==='throw')throw Error('offline');return Promise.resolve(false);}});session.code('secret');session.assets({wabaId:'12',phoneNumberId:'34'});expect(await session.promise).toEqual({kind:'error'});});

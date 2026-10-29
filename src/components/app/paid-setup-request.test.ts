import {afterEach,expect,it,vi} from 'vitest';
import {awaitSetupRequest} from './paid-setup-request';
afterEach(()=>vi.useRealTimers());
it('ends waiting without retrying or accepting a late mutation as confirmed',async()=>{
 vi.useFakeTimers();let finish!:(value:string)=>void;
 const request=vi.fn(()=>new Promise<string>(resolve=>{finish=resolve;}));
 const result=awaitSetupRequest(request(),100);
 const rejected=expect(result).rejects.toThrow('SETUP_REQUEST_TIMEOUT');
 await vi.advanceTimersByTimeAsync(100);await rejected;
 finish('late receipt');await Promise.resolve();expect(request).toHaveBeenCalledTimes(1);
 await expect(result).rejects.toThrow('SETUP_REQUEST_TIMEOUT');
});
it('clears the deadline when the server responds',async()=>{
 vi.useFakeTimers();expect(await awaitSetupRequest(Promise.resolve('receipt'))).toBe('receipt');
 expect(vi.getTimerCount()).toBe(0);
});

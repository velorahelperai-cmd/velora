import {afterEach,expect,it,vi} from 'vitest';
import {createSessionReadBudget,SESSION_READ_BUDGET_MS} from './session-read-budget';
afterEach(()=>vi.useRealTimers());
it('bounds the whole read sequence rather than restarting a timeout per hop',async()=>{
 vi.useFakeTimers();const budget=createSessionReadBudget();
 await budget.read(async()=>true);await vi.advanceTimersByTimeAsync(20000);
 const pending=budget.read(()=>new Promise(()=>{}));
 const failed=expect(pending).rejects.toMatchObject({reason:'deadline'});
 await vi.advanceTimersByTimeAsync(SESSION_READ_BUDGET_MS-20000);await failed;
 expect(vi.getTimerCount()).toBe(0);budget.cancel();
});
it('cancels timers on departure and never starts another read after cancellation',async()=>{
 vi.useFakeTimers();const budget=createSessionReadBudget();
 const pending=budget.read(()=>new Promise(()=>{}));
 const failed=expect(pending).rejects.toMatchObject({reason:'cancelled'});budget.cancel();await failed;
 const next=vi.fn();await expect(budget.read(next)).rejects.toMatchObject({reason:'cancelled'});
 expect(next).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('ignores late completion after a read deadline and does not retry',async()=>{
 vi.useFakeTimers();const budget=createSessionReadBudget();let complete!:(value:string)=>void;
 const work=vi.fn(()=>new Promise<string>(resolve=>{complete=resolve;}));
 const pending=budget.read(work);const failed=expect(pending).rejects.toMatchObject({reason:'deadline'});
 await vi.advanceTimersByTimeAsync(SESSION_READ_BUDGET_MS);await failed;complete('late');
 await Promise.resolve();expect(work).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});

import { afterEach, expect, it, vi } from 'vitest';
import { readEmployeeMotion, subscribeEmployeeMotion } from './employee-motion';
afterEach(() => vi.unstubAllGlobals());
function environment() {
  const preference = Object.assign(new EventTarget(), { matches: false });
  const page = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('window', { matchMedia: () => preference });
  vi.stubGlobal('document', page);
  return { preference, page };
}
it('allows motion only for a visible page without a reduced-motion preference', () => {
  const { preference, page } = environment();
  expect(readEmployeeMotion()).toBe(true);
  page.hidden = true; expect(readEmployeeMotion()).toBe(false);
  page.hidden = false; preference.matches = true; expect(readEmployeeMotion()).toBe(false);
});
it('updates for visibility and preference changes and removes both listeners on unmount', () => {
  const { preference, page } = environment(); const notify = vi.fn();
  const dispose = subscribeEmployeeMotion(notify);
  page.dispatchEvent(new Event('visibilitychange')); preference.dispatchEvent(new Event('change'));
  expect(notify).toHaveBeenCalledTimes(2);
  dispose(); page.dispatchEvent(new Event('visibilitychange')); preference.dispatchEvent(new Event('change'));
  expect(notify).toHaveBeenCalledTimes(2);
});

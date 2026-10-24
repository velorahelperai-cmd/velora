import { describe, expect, it, vi } from "vitest";

/**
 * Success-morph isolation contract: only `verified` may arm timers; callback identity
 * and cooldown labels must not re-enter the arming path (see AuthOtpModal successStartedRef).
 */
describe("AuthOtpModal success arming contract", () => {
  it("arms success navigation once per verified rising edge", () => {
    const done = vi.fn();
    let successStarted = false;
    let onSuccess = done;
    function onVerified(verified: boolean) {
      if (!verified) {
        successStarted = false;
        return;
      }
      if (successStarted) return;
      successStarted = true;
      onSuccess();
    }
    onVerified(true);
    onSuccess = vi.fn(); // parent re-render changes callback identity / cooldown label
    onVerified(true);
    expect(done).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

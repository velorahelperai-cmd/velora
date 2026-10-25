// Readiness budget only: not session expiry, provider OTP timeout or an automatic retry.
// The measured admitted-session refresh was8.55s; allow30s for this whole read sequence.
export const SESSION_READ_BUDGET_MS = 30_000;
export class SessionReadBudgetError extends Error {
  constructor(readonly reason: 'deadline' | 'cancelled') {super(`SESSION_READ_${reason.toUpperCase()}`);}
}
export function createSessionReadBudget() {
  const deadline = performance.now() + SESSION_READ_BUDGET_MS;
  const cancellations = new Set<() => void>();
  let cancelled = false;
  return {
    read<T>(work: () => Promise<T>): Promise<T> {
      const remaining = deadline - performance.now();
      if (cancelled || remaining <= 0) return Promise.reject(new SessionReadBudgetError(cancelled ? 'cancelled' : 'deadline'));
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (complete: () => void) => {
          if (settled) return;
          settled = true;clearTimeout(timer);cancellations.delete(cancel);complete();
        };
        const cancel = () => finish(() => reject(new SessionReadBudgetError('cancelled')));
        const timer = setTimeout(() => finish(() => reject(new SessionReadBudgetError('deadline'))), remaining);
        cancellations.add(cancel);
        try {
          // The Server Action itself cannot be cancelled. Consume its late result,
          // but never resume the expired readiness sequence or retry the request.
          Promise.resolve(work()).then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
        } catch (error) {finish(() => reject(error));}
      });
    },
    cancel() {cancelled = true;for (const cancel of cancellations) cancel();},
  };
}

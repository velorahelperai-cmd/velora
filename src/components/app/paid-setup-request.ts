/** Bounds waiting, not execution. A timed-out mutation has an unknown outcome;
 * callers must reconcile it and must never automatically retry it. */
export function awaitSetupRequest<T>(request: Promise<T>, timeoutMs = 15_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SETUP_REQUEST_TIMEOUT')), timeoutMs);
    request.then(value => { clearTimeout(timer); resolve(value); }, error => {
      clearTimeout(timer); reject(error);
    });
  });
}

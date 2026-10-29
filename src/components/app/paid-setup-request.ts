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

/** Reads may finish after the UI deadline. Keep the verified response available;
 * callers must fence scope/unmount/retry generations before applying it.
 * Unlike mutations, a late read has no side effect or ambiguous receipt. */
export function observeSetupRead<T>(request:Promise<T>,onSlow:()=>void,timeoutMs=15000):Promise<T>{
 const timer=setTimeout(onSlow,timeoutMs);
 return request.finally(()=>clearTimeout(timer));
}

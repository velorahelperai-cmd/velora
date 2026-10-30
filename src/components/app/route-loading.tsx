/** Public skeleton only; no cached identity, tenant data or enabled actions. */
export function RouteLoading() {
  return <main className="app-shell grid gap-4 p-6" aria-busy="true" aria-label="جارٍ التحميل / Loading">
    <div className="h-8 w-48 animate-pulse rounded bg-[var(--color-border-soft)]" />
    <div className="h-48 animate-pulse rounded-2xl bg-[var(--color-border-soft)]" />
  </main>;
}

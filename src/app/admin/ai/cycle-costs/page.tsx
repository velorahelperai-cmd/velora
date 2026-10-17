import Link from "next/link";

/** Phase B admin cycle-cost RPCs removed; required re-implementation in ES04. */
export default function Page() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin" className="text-sm underline">
        Admin
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Cycle costs</h1>
      <p className="mt-2 text-sm opacity-80">
        This administrative cost reader was retired with post-WP01A Phase B cleanup. It will be
        rebuilt under ES04; package cost requirements remain in Velora Brain.
      </p>
    </main>
  );
}

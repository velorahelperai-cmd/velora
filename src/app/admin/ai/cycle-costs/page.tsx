import Link from "next/link";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n";

/** Phase B admin cycle-cost RPCs removed; required re-implementation in ES04. */
export default async function Page() {
  const ar = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value) === "ar";
  return (
    <main className="mx-auto max-w-3xl p-6" dir={ar ? "rtl" : "ltr"}>
      <Link href="/admin" className="text-sm underline">
        {ar ? "لوحة الإدارة" : "Administration"}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">{ar ? "تكاليف دورات الاشتراك" : "Subscription cycle costs"}</h1>
      <p className="mt-2 text-sm opacity-80">
        {ar ? "عرض تكاليف الدورات غير متاح حاليًا. ارجع إلى لوحة الإدارة لمتابعة البيانات المتاحة." : "Cycle cost reporting is currently unavailable. Return to administration to view available data."}
      </p>
    </main>
  );
}

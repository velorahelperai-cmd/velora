import Link from "next/link";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n";
import styles from "./page.module.css";

/** Phase B admin cycle-cost RPCs removed; required re-implementation in ES04. */
export default async function Page() {
  const ar = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value) === "ar";
  return (
    <main className={styles.page} dir={ar ? "rtl" : "ltr"}>
      <Link href="/admin" className={styles.back}>
        {ar ? "لوحة الإدارة" : "Administration"}
      </Link>
      <section className={styles.panel}>
        <h1>{ar ? "تكاليف دورات الاشتراك" : "Subscription cycle costs"}</h1>
        <p>
          {ar ? "عرض تكاليف الدورات غير متاح حاليًا. ارجع إلى لوحة الإدارة لمتابعة البيانات المتاحة." : "Cycle cost reporting is currently unavailable. Return to administration to view available data."}
        </p>
      </section>
    </main>
  );
}

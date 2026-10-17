import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { masterJourneyEnabled } from "@/lib/master-journey/rollout";
import { AccessGate } from "@/components/app/access-gate";

export const dynamic = "force-dynamic";

/** Phase B archive/deletion manager removed; required re-implementation in ES04. */
export default async function Page() {
  if (!masterJourneyEnabled()) redirect("/account");
  const a = await getCompanyAccess();
  if (!a.ok) {
    if (a.code === "UNAUTHENTICATED") redirect("/login?next=%2Faccount%2Fbusinesses%2Fmanage");
    return <AccessGate code={a.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAVAILABLE"} />;
  }
  const ar = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value) === "ar";
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 p-4 pb-20" dir={ar ? "rtl" : "ltr"}>
      <Link href="/account" className="text-sm underline">
        {ar ? "الحساب" : "Account"}
      </Link>
      <h1 className="text-2xl font-semibold">{ar ? "شركاتك" : "Your businesses"}</h1>
      <p className="text-sm opacity-80">
        {ar
          ? "إدارة الأرشفة وطلب الحذف أُزيلت مؤقتًا مع تنظيف ما بعد WP01A، وستُعاد في ES04 وفق Velora Brain."
          : "Archive and deletion management was retired with post-WP01A cleanup and will be rebuilt in ES04 per Velora Brain."}
      </p>
    </main>
  );
}

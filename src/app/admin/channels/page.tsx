import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import { requirePlatformOwner } from "@/lib/tenancy/access";
import { adminListChannels } from "@/lib/tenancy/channels-actions";
import { AdminChannelsHub } from "@/components/admin/admin-channels-hub";

export const metadata: Metadata = { title: "Channels Hub · Velora Admin" };

async function ChannelsContent() {
  const res = await adminListChannels();

  if (!res.ok) {
    if (res.code === "UNAVAILABLE") {
      return (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center text-sm text-red-800" dir="rtl">
          <p className="font-bold">تعذر تحميل بيانات القنوات المركزية من الخادم</p>
          <p className="mt-1 text-xs text-red-600">{res.message || "يرجى التحقق من اتصال قاعدة البيانات والمحاولة لاحقاً."}</p>
        </div>
      );
    }
    return <AccessGate code="FORBIDDEN" />;
  }

  const { channels, stats } = res.data;

  return <AdminChannelsHub channels={channels} stats={stats} />;
}

function ChannelsLoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" dir="rtl">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-20 rounded-2xl bg-[var(--service-surface)] border border-[var(--service-line)]" />
        ))}
      </div>
      <div className="h-14 rounded-2xl bg-[var(--service-surface)] border border-[var(--service-line)]" />
      <div className="h-80 rounded-2xl bg-[var(--service-surface)] border border-[var(--service-line)]" />
    </div>
  );
}

export default async function ChannelsHubPage() {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    if (admin.code === "UNVERIFIED") redirect("/verify-email");
    if (admin.code === "UNAVAILABLE") return <AccessGate code="UNAVAILABLE" />;
    if (admin.code === "FORBIDDEN") return <AccessGate code="FORBIDDEN" />;
    redirect(`/login?next=${encodeURIComponent("/admin/channels")}`);
  }

  return (
    <div className="space-y-6">
      <Suspense fallback={<ChannelsLoadingSkeleton />}>
        <ChannelsContent />
      </Suspense>
    </div>
  );
}

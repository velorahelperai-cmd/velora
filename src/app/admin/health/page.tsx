import type { Metadata } from "next";

export const metadata: Metadata = { title: "Platform Health · Velora Admin" };

export default function PlatformHealthPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--service-line)] pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--service-warning)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--service-accent)]">
            Module 14 · Platform Readiness
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
          جاهزية وصحة المنصة (Platform Health & Readiness)
        </h1>
        <p className="mt-1 text-sm text-[var(--service-muted)]">
          فحص جاهزية وتوافق مكونات المنصة: Supabase، الجلسات، بوابات الدفع، وقنوات Meta والذكاء الاصطناعي.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-[var(--service-subtle)] px-3 py-1 text-xs font-bold text-[var(--service-warning)] border border-[var(--service-line)]">
            قيد الإعداد والربط الخادمي · Stage F
          </span>
          <span className="text-xs text-[var(--service-muted)]">
            فحوصات السلامة تجري آلياً في CI؛ الواجهة التشخيصية الحية تصنف الحالات إلى READY / DEGRADED / BLOCKED / UNKNOWN دون إجراء استدعاءات مدفوعة.
          </span>
        </div>
      </div>
    </div>
  );
}

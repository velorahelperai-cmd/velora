import type { Metadata } from "next";

export const metadata: Metadata = { title: "Audit & Compliance · Velora Admin" };

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--service-line)] pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--service-warning)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--service-accent)]">
            Module 11 · Governance & Audit Logs
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
          سجل التدقيق والامتثال (Audit & Compliance)
        </h1>
        <p className="mt-1 text-sm text-[var(--service-muted)]">
          السجل الإداري غير القابل للتعديل للعمليات الحساسة، ربط الفاعل (Actor)، والتتبع الزمني والـ Correlation IDs.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-[var(--service-subtle)] px-3 py-1 text-xs font-bold text-[var(--service-warning)] border border-[var(--service-line)]">
            قيد الإعداد والربط الخادمي · Stage E
          </span>
          <span className="text-xs text-[var(--service-muted)]">
            تدقيق عمليات كل شركة يسجل فعلياً في قاعدة البيانات ويظهر في صفحة تفاصيل الشركة؛ السجل العام للمنصة قيد الربط الشامل.
          </span>
        </div>
      </div>
    </div>
  );
}

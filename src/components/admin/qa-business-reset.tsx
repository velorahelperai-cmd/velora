'use client';

import { useState } from 'react';
import Link from 'next/link';
import { resetQaBusiness } from '@/lib/tenancy/qa-business-grant-actions';

interface Grant {
  companyId: string;
  name: string;
  persona: string;
  package: string;
  term: string;
  grantedAt?: string;
}

export function QaBusinessReset({ grants }: { grants: Grant[] }) {
  const [selectedId, setSelectedId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const selectedGrant = grants.find((g) => g.companyId === selectedId);

  async function handleRun(commit = false) {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await resetQaBusiness(selectedId, commit ? confirmation : undefined);
      setPreview(res);
      if (commit && res.ok === true && res.action === 'reset') {
        setResetSuccess(true);
      }
    } catch {
      setPreview({ ok: false, code: 'UNKNOWN' });
    } finally {
      setBusy(false);
    }
  }

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedId(e.target.value);
    setPreview(null);
    setConfirmation('');
    setResetSuccess(false);
  }

  return (
    <div dir="rtl" className="max-w-3xl mx-auto space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Top Navigation */}
      <div className="flex items-center justify-between text-xs font-medium text-[var(--service-muted)]">
        <div className="flex items-center gap-1.5">
          <Link href="/admin" className="hover:text-[var(--service-ink)] transition">
            لوحة الإدارة
          </Link>
          <span>/</span>
          <span className="text-[var(--service-ink)]">إدارة تجربة VELORA QA</span>
        </div>
        <Link
          href="/admin"
          className="text-[var(--service-muted)] hover:text-[var(--service-ink)] transition"
        >
          العودة للوحة المتابعة
        </Link>
      </div>

      {/* Header */}
      <div className="space-y-1 border-b border-[var(--service-line)] pb-4">
        <h1 className="text-xl font-bold text-[var(--service-ink)] tracking-normal">
          إدارة تجربة VELORA QA
        </h1>
        <p className="text-xs sm:text-sm text-[var(--service-muted)] leading-relaxed">
          أرشفة نشاط الاختبار وإلغاء صلاحية الوصول لبدء رحلة عميل جديدة من مسار الإعداد (/setup) دون المساس بسجلات الحساب.
        </p>
      </div>

      {/* Success Notification */}
      {resetSuccess && (
        <div className="p-4 rounded-xl border border-emerald-300/80 bg-emerald-50 text-emerald-900 space-y-2">
          <h2 className="text-sm font-bold">تمت أرشفة تجربة VELORA QA بنجاح</h2>
          <p className="text-xs text-emerald-800 leading-relaxed">
            تم إلغاء صلاحية الشركة التجريبية وحفظ السجلات التاريخية. يمكنك الآن خوض رحلة الإعداد كعميل جديد.
          </p>
          <div className="pt-2 flex items-center gap-3">
            <Link
              href="/setup"
              className="inline-block px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 transition"
            >
              فتح مسار الإعداد (/setup)
            </Link>
            <Link
              href="/admin"
              className="inline-block px-3.5 py-1.5 rounded-lg text-xs font-medium text-[var(--service-ink)] bg-white border border-[var(--service-line)] hover:bg-[var(--service-subtle)] transition"
            >
              العودة للوحة المتابعة
            </Link>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {!resetSuccess && (
        <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 sm:p-6 space-y-5">
          {grants.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <h2 className="text-sm font-bold text-[var(--service-ink)]">
                لا توجد تجارب VELORA QA نشطة حالياً
              </h2>
              <p className="text-xs text-[var(--service-muted)] max-w-sm mx-auto leading-relaxed">
                جميع حسابات التجارب مصفّرة وجاهزة. يمكنك بدء تجربة جديدة في أي وقت من خلال مسار الإعداد.
              </p>
              <div className="pt-2">
                <Link
                  href="/setup"
                  className="inline-block px-4 py-2 rounded-lg text-xs font-semibold text-[var(--service-ink)] bg-[var(--service-accent-soft)] hover:bg-[var(--service-subtle)] transition"
                >
                  فتح مسار الإعداد (/setup)
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <label htmlFor="qa-select" className="block text-xs font-semibold text-[var(--service-ink)]">
                  اختر التجربة المراد تصفيرها:
                </label>
                <select
                  id="qa-select"
                  value={selectedId}
                  disabled={busy}
                  onChange={handleSelectChange}
                  className="w-full rounded-lg border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 text-xs font-medium text-[var(--service-ink)] focus:outline-none focus:border-[var(--service-accent)] transition"
                >
                  <option value="">اختر من القائمة...</option>
                  {grants.map((g) => (
                    <option key={g.companyId} value={g.companyId}>
                      {g.name} — باقة: {g.package} · شخصية: {g.persona} · مدة: {g.term}
                    </option>
                  ))}
                </select>

                {selectedGrant && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--service-muted)] pt-1">
                    <span>الشركة: <strong className="text-[var(--service-ink)]">{selectedGrant.name}</strong></span>
                    <span>الباقة: <strong className="text-[var(--service-ink)]">{selectedGrant.package}</strong></span>
                    <span>الشخصية: <strong className="text-[var(--service-ink)]">{selectedGrant.persona}</strong></span>
                  </div>
                )}

                <div className="pt-1">
                  <button
                    type="button"
                    disabled={busy || !selectedId}
                    onClick={() => void handleRun(false)}
                    className="px-4 py-2 rounded-lg text-xs font-semibold text-[var(--service-ink)] bg-[var(--service-accent-soft)] hover:bg-[var(--service-subtle)] disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {busy ? 'جارٍ الفحص...' : 'فحص نطاق إعادة الضبط'}
                  </button>
                </div>
              </div>

              {/* Preview & Confirmation */}
              {preview && (
                <div className="pt-4 border-t border-[var(--service-line)] space-y-4">
                  {preview.ok === true && preview.operation === 'archive_and_revoke' ? (
                    <div className="space-y-4 p-4 rounded-lg border border-[var(--service-line)] bg-[var(--service-canvas)]">
                      <div className="space-y-1">
                        <h3 className="text-xs font-bold text-[var(--service-ink)]">
                          نطاق العملية: جاهز للأرشفة والتصفير
                        </h3>
                        <p className="text-[11px] text-[var(--service-muted)]">
                          الكيان: {String(preview.name ?? 'VELORA QA')} · الفروع المرتبطة: {String(preview.branches ?? 0)} · السجلات التاريخية: محفوظة
                        </p>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-[var(--service-line)]">
                        <label htmlFor="qa-confirm" className="block text-xs font-medium text-[var(--service-ink)]">
                          اكتب <span className="font-mono font-bold text-red-600">RESET VELORA QA</span> للتأكيد:
                        </label>
                        <input
                          id="qa-confirm"
                          type="text"
                          value={confirmation}
                          disabled={busy}
                          placeholder="RESET VELORA QA"
                          onChange={(e) => setConfirmation(e.target.value)}
                          className="w-full max-w-sm rounded-lg border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 text-xs font-mono text-[var(--service-ink)] focus:outline-none focus:border-red-500"
                        />
                        <div>
                          <button
                            type="button"
                            disabled={busy || confirmation !== 'RESET VELORA QA'}
                            onClick={() => void handleRun(true)}
                            className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                          >
                            {busy ? 'جارٍ التصفير...' : 'أرشفة التجربة والبدء من جديد'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : preview.ok === false ? (
                    <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs space-y-1">
                      <p className="font-bold">تعذر إتمام العملية ({String(preview.code)})</p>
                      <p className="text-[11px] text-red-700">
                        {preview.code === 'DEPENDENCIES_REQUIRE_REVIEW'
                          ? 'توجد ارتباطات نشطة تتطلب مراجعة قبل التصفير.'
                          : preview.code === 'NOT_QA_GRANT'
                          ? 'هذا الكيان ليس مسجلاً كمنحة تجريبية.'
                          : preview.code === 'FORBIDDEN'
                          ? 'ليس لديك صلاحية مالك المنصة لإجراء هذه العملية.'
                          : 'حدث خطأ أثناء فحص النطاق.'}
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

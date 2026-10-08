"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo } from "@/lib/demo-state";
import { readCatalogAdminAction, saveCatalogDraftAction, publishCatalogVersionAction } from "@/lib/billing/catalog-backend/actions";
import { FEATURE_KEYS, type CatalogDraft, type CatalogAdminSnapshot, type CatalogResult, type VariantCode } from "@/lib/billing/catalog-backend/contract";
import { catalogEditorVersions, editorDraft, VARIANT_CODES, type CatalogEditorVersion } from "./admin-catalog-model";
import { featureLabels, formatOmrBaisa } from "./subscription-offers-view";
import styles from "./admin-catalog.module.css";

const copy = {
  ar: {
    kicker: "عمليات الفوترة والاشتراكات",
    title: "كتالوج الاشتراكات والباقات",
    intro: "إدارة الإصدارات، الأسعار الشهرية بالريال العماني بدقة 3 منازل، وسقف الرسائل الشهرية وحالات المزايا.",
    back: "لوحة المنصة",
    retry: "تحديث الكتالوج",
    unavailable: "كتالوج الاشتراكات غير مجهّز بعد في قاعدة البيانات. لا يمكن الحفظ أو النشر حاليًا.",
    forbidden: "إدارة الكتالوج تتطلب مالك المنصة. صلاحية أدمن أو مالك شركة وحدها لا تكفي.",
    invalid: "تعذّر التحقق من بيانات الكتالوج. الإجراءات معطّلة حتى تحديث البيانات.",
    history: "سجل الإصدارات",
    empty: "لا توجد إصدارات مسجّلة بعد.",
    new: "إصدار جديد كمسودة",
    edit: "تعديل المسودة",
    clone: "نسخ كمسودة جديدة",
    price: "السعر الشهري (ر.ع.)",
    cap: "الحد الشهري للرسائل الآلية الصادرة الناجحة",
    variant: "الشخصية والمستوى",
    features: "حالة المزايا والقدرات",
    omit: "غير مدرجة (—)",
    target: "مخطط (Planned)",
    unverified: "غير متحقق منها (Not verified)",
    save: "حفظ المسودة",
    publish: "نشر الإصدار رسميًا",
    confirm: "تأكيد نشر هذا الإصدار",
    cancel: "إلغاء",
    saved: "أكد الخادم حفظ المسودة بنجاح.",
    published: "أكد الخادم نشر الإصدار بنجاح.",
    conflict: "تغيّر الكتالوج أثناء التحرير (تعارض في المراجعة). حدّث البيانات ثم راجع التعديل.",
    error: "تعذّر إتمام الطلب على الخادم. لم يتم تأكيد العملية.",
    annualNotice: "تنبيه: التسعير السنوي غير معتمد في الكتالوج الحالي. الفترات المدعومة هي الاشتراكات الشهرية فقط.",
    draft: "مسودة",
    publishedStatus: "منشور",
    retired: "متقاعد",
    revision: "مراجعة الكتالوج",
    version: "الإصدار",
    immutable: "الإصدارات المنشورة والمتقاعدة غير قابلة للتعديل؛ التعديلات تتطلب إنشاء مسودة جديدة.",
    publishReview: "مراجعة تفاصيل الإصدار قبل النشر",
    publishWarning: "بمجرد النشر، يصبح هذا الإصدار ثابتًا (Immutable) ويظهر للعملاء في واجهة الباقات. هل أنت متأكد من النشر؟",
    invalidInput: "أدخل سعرًا موجبًا بالريال العماني (3 منازل عشرية كحد أقصى) وحدًا شهريًا صحيحًا موجبًا.",
    filterAll: "كافة الإصدارات",
    filterPublished: "المنشورة فقط",
    filterDraft: "المسودات فقط",
    filterRetired: "المتقاعدة",
    statRevision: "رقم المراجعة الحالية",
    statPublished: "الباقات المنشورة",
    statDrafts: "المسودات النشطة",
    statProductionTier: "الباقة المعتمدة إنتاجيًا",
    policyTitle: "سياسة الإطلاق والإنتاج المعتمدة",
    policyText: "الباقة الوحيدة المعتمدة للشراء الفعلي وبوابة الدفع هي باقة نور الأساسية الشهرية (45.000 ر.ع). نشر أي باقة أخرى يعرضها للعميل كمرجع ولكن الشراء يظل معطّلًا حتى الاعتماد المنصي والمالي الرسمي.",
    approvedOnlyBadge: "معتمد للشراء",
  },
  en: {
    kicker: "Billing & Subscription Operations",
    title: "Subscription & Plan Catalog",
    intro: "Manage versions, 3-decimal monthly OMR pricing, automated outbound message limits, and durable feature states.",
    back: "Platform Dashboard",
    retry: "Refresh Catalog",
    unavailable: "The subscription catalog is not configured. Saving and publishing are unavailable.",
    forbidden: "Catalog management requires the platform owner. Admin or tenant owner permissions alone are insufficient.",
    invalid: "Catalog data could not be validated. Actions are disabled until refreshed.",
    history: "Version History",
    empty: "No versions are recorded yet.",
    new: "New Draft Version",
    edit: "Edit Draft",
    clone: "Copy as New Draft",
    price: "Monthly Price (OMR)",
    cap: "Successful automated outbound messages per month",
    variant: "Character & Tier",
    features: "Feature Readiness States",
    omit: "Not Included (—)",
    target: "Planned",
    unverified: "Not Verified",
    save: "Save Draft",
    publish: "Publish Version",
    confirm: "Confirm Publication",
    cancel: "Cancel",
    saved: "Server confirmed draft saved successfully.",
    published: "Server confirmed version published successfully.",
    conflict: "Catalog was modified during editing (revision conflict). Refresh and review changes.",
    error: "Server request failed. Operation was not confirmed.",
    annualNotice: "Notice: Annual pricing is not approved in this catalog revision. Supported billing cycles are monthly only.",
    draft: "Draft",
    publishedStatus: "Published",
    retired: "Retired",
    revision: "Catalog Revision",
    version: "Version",
    immutable: "Published and retired versions are immutable. Changes require creating a new draft version.",
    publishReview: "Review Version Details Before Publishing",
    publishWarning: "Once published, this version becomes immutable and visible to customers on plan cards. Are you sure you want to proceed?",
    invalidInput: "Enter a positive OMR price (at most 3 decimal places) and a positive whole monthly limit.",
    filterAll: "All Versions",
    filterPublished: "Published Only",
    filterDraft: "Drafts Only",
    filterRetired: "Retired",
    statRevision: "Active Revision",
    statPublished: "Published Plans",
    statDrafts: "Active Drafts",
    statProductionTier: "Production Live Tier",
    policyTitle: "Production & Commercial Policy",
    policyText: "The only commercially approved tier for checkout and payment collection is Noor Basic Monthly (45.000 OMR). Publishing other versions displays them for reference, but checkout remains disabled until formal commercial authorization.",
    approvedOnlyBadge: "Live Approved",
  },
} as const;

const priceText = (baisa: number) => {
  const whole = (BigInt(baisa) / BigInt(1000)).toString();
  const frac = (BigInt(baisa) % BigInt(1000)).toString().padStart(3, "0");
  return `${whole}.${frac}`;
};

export function AdminCatalog({ initial }: { initial: CatalogResult<CatalogAdminSnapshot> }) {
  const { locale } = useDemo();
  const c = copy[locale];
  const [result, setResult] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [filter, setFilter] = useState<"all" | "published" | "draft" | "retired">("all");
  const [code, setCode] = useState<VariantCode>("noor_basic");
  const [price, setPrice] = useState("");
  const [cap, setCap] = useState("");
  const [features, setFeatures] = useState<CatalogDraft["feature_availability"]>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [review, setReview] = useState<CatalogEditorVersion | null>(null);

  const rows = result.ok ? catalogEditorVersions(result.data) : null;
  const ready = result.ok && rows !== null;
  const revision = result.ok ? result.data.revision : null;

  const publishedCount = rows?.filter(r => r.status === "published").length ?? 0;
  const draftCount = rows?.filter(r => r.status === "draft").length ?? 0;
  const filteredRows = rows?.filter(r => {
    if (filter === "all") return true;
    return r.status === filter;
  }) ?? [];

  async function reload() {
    setBusy(true);
    setMessage(null);
    setReview(null);
    try {
      setResult(await readCatalogAdminAction());
    } catch {
      setResult({ ok: false, code: "unavailable" });
    } finally {
      setBusy(false);
    }
  }

  function pick(row: CatalogEditorVersion | null, clone = false) {
    setEditing(row && !clone ? row.versionId : null);
    setCode(row?.code ?? "noor_basic");
    setPrice(row ? priceText(row.amount_baisa) : "");
    setCap(row ? String(row.automated_outbound_per_month) : "");
    setFeatures(row ? { ...row.feature_availability } : {});
    setReview(null);
    setMessage(null);
  }

  async function save() {
    const draft = editorDraft(code, price, cap, features);
    if (!draft || !ready || revision === null) {
      setMessage(c.invalidInput);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveCatalogDraftAction(draft, revision, editing);
      if (!saved.ok) {
        setMessage(saved.code === "conflict" ? c.conflict : c.error);
        if (saved.code === "conflict") setResult({ ok: false, code: "conflict" });
        return;
      }
      setEditing(null);
      setResult(await readCatalogAdminAction());
      setMessage(c.saved);
    } catch {
      setMessage(c.error);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!review || review.status !== "draft" || !ready || revision === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const published = await publishCatalogVersionAction(review.versionId, revision);
      if (!published.ok) {
        setMessage(published.code === "conflict" ? c.conflict : c.error);
        if (published.code === "conflict") setResult({ ok: false, code: "conflict" });
        return;
      }
      setReview(null);
      setResult(await readCatalogAdminAction());
      setMessage(c.published);
    } catch {
      setMessage(c.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page} lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className={styles.wrap}>
        {/* Header */}
        <header className={styles.heading}>
          <div>
            <span className={styles.kicker}>{c.kicker}</span>
            <h1>{c.title}</h1>
            <p>{c.intro}</p>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button type="button" onClick={() => void reload()} disabled={busy}>
              {c.retry}
            </button>
            <Link href="/admin">{c.back}</Link>
          </div>
        </header>

        {/* Production Guardrail Banner */}
        <div className={styles.policyBanner} role="status">
          <span className={styles.policyIcon} aria-hidden="true">🛡️</span>
          <div className={styles.policyContent}>
            <h4>{c.policyTitle}</h4>
            <p>{c.policyText}</p>
          </div>
        </div>

        {/* Stats Row */}
        {ready ? (
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{c.statRevision}</span>
              <span className={styles.statValue}>Rev #{revision}</span>
              <span className={styles.statSub}>PostgreSQL RLS Protected</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{c.statPublished}</span>
              <span className={styles.statValue}>{publishedCount}</span>
              <span className={styles.statSub}>{locale === "ar" ? "إصدارات منشورة للعملاء" : "Published to public"}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{c.statDrafts}</span>
              <span className={styles.statValue}>{draftCount}</span>
              <span className={styles.statSub}>{locale === "ar" ? "مسودات قيد الإعداد" : "Drafts under review"}</span>
            </div>
            <div className={styles.statCard} style={{ borderInlineStart: "4px solid var(--catalog-emerald)" }}>
              <span className={styles.statLabel}>{c.statProductionTier}</span>
              <span className={styles.statValue} style={{ fontSize: 20 }}>Noor Basic</span>
              <span className={styles.statSub} style={{ color: "var(--catalog-emerald)" }}>{formatOmrBaisa(45000, locale)} · {c.approvedOnlyBadge}</span>
            </div>
          </div>
        ) : null}

        {message ? <p role="status">{message}</p> : null}

        {!ready ? (
          <section className={styles.panel} role="alert">
            {!result.ok && result.code === "forbidden"
              ? c.forbidden
              : !result.ok && result.code === "conflict"
              ? c.conflict
              : result.ok
              ? c.invalid
              : c.unavailable}
          </section>
        ) : (
          <div className={styles.grid}>
            {/* Left: Draft Editor */}
            <section className={styles.panel}>
              <h2>{editing ? c.edit : c.new}</h2>
              <p>{c.revision}: Rev #{revision}</p>
              <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
                <label>
                  {c.variant}
                  <select
                    value={code}
                    disabled={busy || editing !== null}
                    onChange={(event) => setCode(event.target.value as VariantCode)}
                  >
                    {VARIANT_CODES.map((item) => (
                      <option key={item} value={item}>
                        {item.replace("_", " / ")} {item === "noor_basic" ? `(${locale === "ar" ? "معتمد 45 ر.ع" : "Approved 45 OMR"})` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  {c.price}
                  <input
                    dir="ltr"
                    inputMode="decimal"
                    placeholder="e.g. 45.000"
                    required
                    value={price}
                    disabled={busy}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                  <small style={{ fontSize: 11, color: "var(--catalog-secondary)" }}>
                    {locale === "ar" ? "أدخل القيمة بالريال بدقة تصل إلى 3 منازل (مثل 45.000)" : "Enter amount in OMR up to 3 decimals (e.g. 45.000)"}
                  </small>
                </label>

                <label>
                  {c.cap}
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    placeholder="e.g. 1000"
                    required
                    value={cap}
                    disabled={busy}
                    onChange={(event) => setCap(event.target.value)}
                  />
                  <small style={{ fontSize: 11, color: "var(--catalog-secondary)" }}>
                    {locale === "ar" ? "الحد الأقصى للرسائل الآلية شهريًا" : "Max automated outbound messages per month"}
                  </small>
                </label>

                <fieldset>
                  <legend>{c.features}</legend>
                  {FEATURE_KEYS.map((key) => (
                    <label key={key} style={{ margin: "10px 0" }}>
                      {featureLabels[key][locale]}
                      <select
                        disabled={busy}
                        value={features[key] ?? ""}
                        onChange={(event) => setFeatures((previous) => {
                          const next = { ...previous };
                          if (!event.target.value) delete next[key];
                          else next[key] = event.target.value as "target" | "not_verified";
                          return next;
                        })}
                      >
                        <option value="">{c.omit}</option>
                        <option value="target">{c.target}</option>
                        <option value="not_verified">{c.unverified}</option>
                      </select>
                    </label>
                  ))}
                </fieldset>

                <p style={{ fontSize: 12, color: "var(--catalog-secondary)", marginTop: 16 }}>{c.annualNotice}</p>

                <div className={styles.actions}>
                  <button disabled={busy} type="submit">{c.save}</button>
                  {editing ? (
                    <button type="button" disabled={busy} onClick={() => pick(null)}>{c.cancel}</button>
                  ) : null}
                </div>
              </form>
            </section>

            {/* Right: Versions History & Management */}
            <section className={styles.panel}>
              <h2>{c.history}</h2>
              <p>{c.immutable}</p>

              {/* Filter Tabs */}
              <div className={styles.filterTabs} role="group" aria-label="Version status filter">
                {(["all", "published", "draft", "retired"] as const).map((filterType) => (
                  <button
                    key={filterType}
                    type="button"
                    aria-pressed={filter === filterType}
                    className={styles.filterTab}
                    onClick={() => setFilter(filterType)}
                  >
                    {filterType === "all" ? c.filterAll :
                     filterType === "published" ? c.filterPublished :
                     filterType === "draft" ? c.filterDraft : c.filterRetired}
                  </button>
                ))}
              </div>

              {!filteredRows.length ? (
                <p>{c.empty}</p>
              ) : (
                <div className={styles.versionList}>
                  {filteredRows.map((row) => (
                    <article key={row.versionId} className={styles.versionCard}>
                      <div className={styles.versionCardTop}>
                        <h3>{row.code.replace("_", " / ")}</h3>
                        <div className={styles.versionMeta}>
                          <span className={styles.versionRevisionBadge}>{c.version} v{row.version}</span>
                          <span className={styles.statusBadge} data-status={row.status}>
                            {row.status === "draft" ? c.draft :
                             row.status === "published" ? c.publishedStatus : c.retired}
                          </span>
                        </div>
                      </div>

                      <div className={styles.versionDetails}>
                        <div className={styles.versionDetailItem}>
                          <strong><bdi>{priceText(row.amount_baisa)}</bdi> {locale === "ar" ? "ر.ع." : "OMR"}</strong>
                          <span>{locale === "ar" ? "السعر الشهري" : "Monthly Price"}</span>
                        </div>
                        <div className={styles.versionDetailItem}>
                          <strong>{new Intl.NumberFormat(locale).format(row.automated_outbound_per_month)}</strong>
                          <span>{locale === "ar" ? "رسالة آلية / شهر" : "Messages / mo"}</span>
                        </div>
                      </div>

                      <div className={styles.featurePillList}>
                        {Object.entries(row.feature_availability).map(([k, v]) => (
                          <span key={k} className={styles.featurePill} data-state={v}>
                            {featureLabels[k]?.[locale] ?? k}: {v === "target" ? c.target : c.unverified}
                          </span>
                        ))}
                      </div>

                      <small className={styles.versionIdText}>UUID: {row.versionId}</small>

                      <div className={styles.actions}>
                        <button
                          disabled={busy}
                          type="button"
                          onClick={() => pick(row, row.status !== "draft")}
                        >
                          {row.status === "draft" ? c.edit : c.clone}
                        </button>
                        {row.status === "draft" ? (
                          <button
                            disabled={busy}
                            type="button"
                            style={{ background: "#C8A673" }}
                            onClick={() => setReview(row)}
                          >
                            {c.publish}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* Publish Review Modal */}
        {review && ready ? (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="catalog-publish-title">
            <div className={styles.modalCard}>
              <h2 id="catalog-publish-title">{c.publishReview}</h2>
              <div className={styles.modalWarning}>
                <strong>⚠️ {c.publishWarning}</strong>
              </div>
              <p><strong>{c.variant}:</strong> {review.code.replace("_", " / ")} ({c.version} v{review.version})</p>
              <p><strong>{c.price}:</strong> <bdi>{priceText(review.amount_baisa)}</bdi> {locale === "ar" ? "ر.ع." : "OMR"}</p>
              <p><strong>{c.cap}:</strong> {new Intl.NumberFormat(locale).format(review.automated_outbound_per_month)}</p>
              
              <div style={{ margin: "14px 0" }}>
                <strong style={{ fontSize: 13, color: "var(--catalog-link)" }}>{c.features}:</strong>
                <ul style={{ paddingInlineStart: 20, margin: "6px 0", fontSize: 13 }}>
                  {Object.entries(review.feature_availability).map(([key, value]) => (
                    <li key={key}>
                      {featureLabels[key]?.[locale] ?? key} · {value === "target" ? c.target : c.unverified}
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.actions} style={{ marginTop: 24, justifyContent: "flex-end" }}>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => setReview(null)}
                  style={{ background: "transparent", borderColor: "var(--catalog-border)" }}
                >
                  {c.cancel}
                </button>
                <button
                  disabled={busy}
                  type="button"
                  style={{ background: "var(--catalog-action)" }}
                  onClick={() => void publish()}
                >
                  {c.confirm}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

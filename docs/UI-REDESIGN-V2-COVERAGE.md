# Velora design system v2 — route coverage

Status: INITIAL INVENTORY / NOT COMPLETE. The owner-supplied `VELORA_DESIGN_SYSTEM_AR.md` dated 2026-11-02 is the current visual specification. This table is a route-entry baseline, not proof of redesign or acceptance. Preserve all existing functions, role gates and data. Public marketing, registration and public checkout are excluded; setup and in-panel billing are included.

Source snapshot: local HEAD `c7a517fd18c4c42f0940b9925f68b54ce28fdbb5` plus the current working tree, 2026-11-02. Graphify index `fd43628c61614434f2278dea303ff47f6f26f164` predates HEAD and excludes working-tree changes; use it only as a locator and inspect current files. Existing partial work/evidence remains in `docs/UI-REDESIGN-COVERAGE.md`; reconcile it row by row rather than treating it as V2 acceptance. Route enumeration does not inventory query-state tabs, dialogs, role variants, navigation-only destinations or all nested screens. Those must be added and individually verified. QA entries require scope determination.

Progress per row: inventoried → designed → implemented → verified. No row is complete based on this listing. Verification must record actual role, source, viewport, language, functional and keyboard evidence; inaccessible states stay explicitly unverified. Publication and live acceptance are separate and not authorized by the design document itself.

| اللوحة | المسار الفعلي | الدور | الوظائف الحالية | قالب التصميم | المكونات المشتركة | الحالات المطلوبة | حالة التنفيذ | دليل الفحص |
|---|---|---|---|---|---|---|---|---|
| إدارة المنصة | `/admin/access` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AdminPlatformAccess` (@/components/admin/admin-platform-access), `AccessGate` (@/components/app/access-gate)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/access/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/accounts` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AccessGate` (@/components/app/access-gate), `AdminAccountsDirectory, AdminAccountsHeading` (@/components/admin/admin-accounts-directory)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/accounts/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/ai/cycle-costs` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة يحتاج فحص أعمق للصلاحيات والأفعال | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/ai/cycle-costs/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/ai` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AdminAIOperations` (@/components/admin/admin-ai-operations), `AccessGate` (@/components/app/access-gate)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/ai/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/analytics` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AdminFinancialAnalytics` (@/components/admin/admin-financial-analytics), `AccessGate` (@/components/app/access-gate)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/analytics/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/audit` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AdminAuditCompliance` (@/components/admin/admin-audit-compliance), `AccessGate` (@/components/app/access-gate)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/audit/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/billing/orders/[id]` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AdminBillingOrderView` (@/components/admin/billing-order)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/billing/orders/[id]/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/billing` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AdminBillingLedger` (@/components/admin/billing-ledger)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/billing/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/catalog` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AdminCatalog` (@/components/app/admin-catalog)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/catalog/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/channels` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AccessGate` (@/components/app/access-gate), `AdminChannelsHub` (@/components/admin/admin-channels-hub)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/channels/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/companies/[id]/conversations` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AccessGate` (@/components/app/access-gate), `AdminConversationsView` (@/components/app/admin-conversations)؛ حصر الأفعال قيد الفحص | المحادثات | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/companies/[id]/conversations/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/companies/[id]` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `safeCompanyReturnHref` (@/components/app/admin-company-navigation), `AccessGate` (@/components/app/access-gate), `AdminCompanyDetail, type AdminAudit, type AdminCompany, type AdminCompanyBranch, type AdminMember,` (@/components/app/admin-company-detail)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/companies/[id]/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/companies` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | إعادة توجيه موجودة؛ تحقق من الوجهة والمعاملات | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/companies/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/health` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AdminPlatformHealth` (@/components/admin/admin-platform-health), `AccessGate` (@/components/app/access-gate)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/health/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/identity-recovery` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `IdentityRecoveryAdminPanel` (@/components/admin/identity-recovery-panel)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/identity-recovery/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/operations` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AdminOperationsCenter` (@/components/admin/admin-operations-center), `AccessGate` (@/components/app/access-gate)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/operations/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `companyListFilters,companyListReturnHref` (@/components/app/admin-company-navigation), `AdminList` (@/components/app/admin-list)؛ حصر الأفعال قيد الفحص | الرئيسية والمؤشرات | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/qa` | حارس المنصة؛ تفاصيل الدور تحتاج فحص؛ مسار QA يحتاج تحديد النطاق | مدخل الصفحة: `QaBusinessReset` (@/components/admin/qa-business-reset)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/qa/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/settings` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AdminPlatformSettings` (@/components/admin/admin-platform-settings), `AccessGate` (@/components/app/access-gate)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/settings/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/support` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `AdminSupportReviews` (@/components/admin/admin-support-reviews), `AccessGate` (@/components/app/access-gate)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/support/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| إدارة المنصة | `/admin/teams` | حارس المنصة؛ تفاصيل الدور تحتاج فحص | مدخل الصفحة: `renderTeamsRoute,type TeamSearchParams` (@/components/teams/teams-route)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/admin/teams/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل | `/app/conversations` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `UnifiedInbox` (@/components/app/unified-inbox)؛ حصر الأفعال قيد الفحص | المحادثات | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/app/conversations/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل | `/app/instagram` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `InstagramConnectionPage` (@/components/app/instagram-connection-page)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/app/instagram/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل | `/app/knowledge` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `AccessGate` (@/components/app/access-gate), `KnowledgePage` (@/components/app/workspace-pages)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/app/knowledge/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل | `/app/organization` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `EnterpriseOrganization` (@/components/app/enterprise-organization)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/app/organization/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل | `/app` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `DashboardPage` (@/components/app/dashboard)؛ حصر الأفعال قيد الفحص | الرئيسية والمؤشرات | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/app/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل | `/app/settings` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `SettingsRoute` (@/components/app/settings-route)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/app/settings/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل | `/app/subscription/orders/[orderId]` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `AccessGate` (@/components/app/access-gate), `SubscriptionPaymentStatus` (@/components/app/subscription-payment-status), `offersViewFromCatalog` (@/components/app/subscription-offers-view)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/app/subscription/orders/[orderId]/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل | `/app/subscription` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `SettingsRoute` (@/components/app/settings-route)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/app/subscription/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل | `/app/test` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `AccessGate` (@/components/app/access-gate), `TestPage` (@/components/app/workspace-pages)؛ حصر الأفعال قيد الفحص | جدول / تفاصيل / نموذج بحسب الوظيفة | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/app/test/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل | `/branch` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `BranchInboxRealtime` (@/components/app/branch-inbox-realtime)؛ حصر الأفعال قيد الفحص | المحادثات | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/branch/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل — التجهيز | `/setup/branches/[branchId]/whatsapp` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `AccessGate` (@/components/app/access-gate), `PaidWhatsappRoute` (@/components/app/paid-whatsapp-route)؛ حصر الأفعال قيد الفحص | إعداد وخطوات | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/setup/branches/[branchId]/whatsapp/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل — التجهيز | `/setup/branches` | يتطلب فحص المسار والصلاحيات | إعادة توجيه موجودة؛ تحقق من الوجهة والمعاملات | إعداد وخطوات | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/setup/branches/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل — التجهيز | `/setup` | يتطلب فحص المسار والصلاحيات | مدخل الصفحة: `SetupAccountEntry` (@/components/app/setup-account-entry)؛ حصر الأفعال قيد الفحص | إعداد وخطوات | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/setup/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |
| العميل — التجهيز | `/setup/qa` | يتطلب فحص المسار والصلاحيات؛ مسار QA يحتاج تحديد النطاق | إعادة توجيه موجودة؛ تحقق من الوجهة والمعاملات | إعداد وخطوات | يحتاج مطابقة | تحميل، فارغ، خطأ، صلاحية، RTL/LTR، أحجام الشاشات حسب الانطباق | محصور مبدئيًا؛ التطبيق غير مؤكد | `src/app/setup/qa/page.tsx`؛ فحص مرئي ووظيفي NOT_RUN |

## Shared customer shell — initial implementation

The workspace sidebar now uses a white floating surface, visible navigation labels and a teal current item in `src/components/app/internal-ui.module.css`; existing links, account disclosure and mobile menu handlers remain. `npx vitest run src/components/app/workspace-frame.test.tsx`: 1 test passed. Calculated white on `#147d73`: 4.99:1. This test does not verify rendered layout, keyboard behavior, mobile drawer/focus, short viewports, RTL/LTR or role-specific journeys. Those remain NOT_RUN; the shell and routes are not accepted. Admin shell, setup, all page families and motion still require V2 work.

## Shared platform-admin shell — initial implementation

The existing admin sidebar now has a white floating desktop surface, a teal current item, readable group text, and wrapping navigation labels. Existing role-filtered navigation and collapse/menu handlers remain. Desktop expanded width is 240px; the collapsed content offset accommodates the outer margin. Three targeted suites (`admin-navigation`, `admin-platform-access`, and `workspace-frame`): 9 tests passed; scoped ESLint and `git diff --check` passed. These are source/isolated checks only: desktop/mobile rendering, keyboard focus containment and restoration, zoom, RTL/LTR, and role-specific journeys remain NOT_RUN. The existing mobile navigation requires a direct focus-management review; do not mark the shell verified.

## Shared palette and customer dashboard — initial implementation

Workspace and admin scoped service colors now match the V2 white, ink, border and brand tokens. Existing customer dashboard metrics remain backed by their original data and links, but are separated into responsive bordered KPI cards; interactive hover elevation is disabled under reduced motion. Content panels use the specified local card shadow/radius. Five focused suites (dashboard refresh, branch, inbox live, admin navigation, workspace frame): 27 passed; diff whitespace check passed. Actual contrast of all rendered combinations and browser visual/responsive/keyboard acceptance are NOT_RUN. This does not cover other pages or Magic UI effects.

## Admin mobile navigation — keyboard behavior

Opening the mobile admin drawer now marks it as a modal dialog, makes the main workspace inert, focuses the close control, wraps Tab at the visible focus boundaries, and restores focus to the opener when closed. A viewport change to desktop closes the mobile state. The new jsdom test exercises focus entry, both Tab boundaries, background inertness and Escape restoration; together with existing admin navigation and platform-access tests, 9 tests passed. Scoped ESLint and diff check passed. The test simulates element visibility: actual browser focus, touch, resize and screen-reader behavior remain NOT_RUN.

## Assistant workspace — decorative border

The existing non-compact assistant test header now has a CSS border-beam treatment. A small client wrapper pauses animation when outside the viewport or when the document is hidden, and CSS disables animation for reduced motion. The compact setup variant does not display the effect. No provider call or trial was made. Observer lifecycle and existing assistant tests: 6 tests passed; scoped ESLint passed. Actual appearance, cross-browser mask/property support, performance and reduced-motion behavior in a browser remain NOT_RUN. Other requested motion patterns and other page families remain open.

## Admin AI — decorative border

The existing administrative AI diagnostic form is wrapped in the same decorative, visibility-aware border treatment as the customer assistant header. It does not represent provider state or alter the form handlers. Three AI/assistant/motion suites: 9 tests passed; scoped ESLint and whitespace check passed. No trial or provider request was made. Browser motion, layout and compatibility remain NOT_RUN; this does not complete the admin page family.

## Local browser observation — 2026-11-02

Opened a new in-app browser tab at `http://127.0.0.1:3000/app`; the existing server was neither started nor stopped. At 1280×720, the initial workspace shell showed the white floating sidebar, full Arabic labels and teal current item; document width matched viewport (1280px). The dashboard body remained blank during the observed initial state and the browser logged `whatsapp.inbox_read_failed`. At 390×844 the initial shell reflowed to a top menu and no horizontal clipping was visible, then the session displayed “تعذّر جلب هوية الحساب” with retry. No menu interaction, messages, provider requests, or data changes were made. This was a real-backend local session, not an isolated fixture, and is not a successful authenticated dashboard, mobile drawer, full page or motion acceptance. The mobile workspace menu still requires conversion/review against the V2 drawer and focus requirements. Browser viewport was reset and the temporary tab closed.

## Customer workspace mobile drawer

The mobile workspace navigation is now a fixed side drawer with an overlay and close button, modal semantics, inert background and keyboard focus containment/restoration; links and account/language controls remain. A jsdom interaction test plus existing workspace shell test passed (2 tests); scoped ESLint and whitespace check passed. At 390×844, the local browser accessibility tree showed the drawer, all navigation links and the close button focused after opening. Before a stable screenshot or further keyboard checks the session navigated to `/admin`; no mutation was made. Actual visual layout, Escape/Tab behavior in the browser, other languages, and complete authenticated acceptance remain NOT_RUN.

## Admin overview — desktop browser adjustment

The owner requested desktop-first work. An authenticated local desktop view at approximately 1280×720 showed five narrow metrics in a single row. The existing five data cards were reflowed to three columns at this viewport, with 20px padding and 12px radius; at wider desktop sizes the grid allows four columns. Browser hot-update showed the five original values across two rows with readable labels. Admin company count, navigation, and shell suites: 18 tests passed. This is one Arabic desktop observation only; other admin sections, English, accessibility and full acceptance remain open. No data-changing action was performed.

## Admin AI — desktop inspection

At approximately 1280×720 in the authenticated local browser, the AI overview and diagnostic form rendered with the white sidebar and a restrained border highlight. The synthetic test confirmation checkbox was visually oversized and separated from its label; its label is now a 44px minimum-height flex target with an 18px checkbox. Browser hot update showed the checkbox beside its Arabic label; it was unavailable in the observed state, and no test was submitted. Three relevant suites: 26 passed; scoped ESLint and whitespace check passed. English, other widths, animation timing/reduced motion, and provider journeys remain NOT_RUN. The displayed readiness code requires separate product-copy review; it is not evidence that setup is complete.

## Admin channels — desktop inspection

At approximately 1280×720, the six loaded-record metrics appeared compressed into one row. They now render in three columns at that width, with 120px minimum height, 20px padding and a restrained card shadow; the source-incompleteness warning and recorded-state wording remain. The local browser showed the revised two-row grid and existing empty state; the observed result had zero loaded records and is not proof that no channels exist. Two relevant suites: 12 tests passed; scoped ESLint and diff check passed. Populated rows, English and full page acceptance remain NOT_RUN; no channel state changed.

## Admin billing — desktop inspection

At approximately 1280×720 the local billing page showed three summary cards, four labeled filters, the scope caveats and an empty ledger. The cards now use 20px padding and the normal card shadow; filter controls use 8px corners and an explicit focus-visible outline. In the browser, Tab from the company field to the environment select produced a computed 2px teal outline. Billing and stage-D suites: 11 tests passed; scoped ESLint and diff check passed. No query was submitted and no financial action occurred. Populated orders, other focus targets, English and full financial acceptance remain NOT_RUN.

## Admin accounts — desktop table

At approximately 1280×720, the local account directory showed long email addresses breaking while the actions column held excess width. Reallocated the existing fixed column widths to give email 27% and actions 25%, retaining all columns and controls. Browser hot update showed the first address on one line and actions still visible; longer addresses can wrap. Accounts-directory and stage-C suites: 14 tests passed. No account or identity action was invoked. English, other data lengths, keyboard interaction and full acceptance remain NOT_RUN.

## Admin companies — desktop table accessibility

`/admin/companies` redirects to the companies section of `/admin`, preserving string query parameters. The status filter now has a visible keyboard outline; the horizontally scrollable table has a named, focusable region and the location/email text is 13px. Existing searches, state and detail links remain. Three company count/navigation/return suites: 41 tests passed; scoped ESLint and diff check passed. A new local browser attempt ended at “تعذّر جلب هوية الحساب”, so this revision has not been visually or keyboard verified in an authenticated browser. No company action was taken.

## Admin support forms — desktop styling

Scoped text inputs, selects and textareas in the existing support/review interface now use the V2 8px control radius and 14px text; textareas have an 88px minimum height and can still grow. Checkbox/radio styling and all support actions remain unchanged. Support UI suite: 6 tests passed. The existing authenticated local browser session became unavailable, so this change has not been visually checked and no ticket, note or review action was performed. Full page coverage remains open.

## Owner request — remove icons, desktop

Removed decorative icons from customer workspace navigation and its account/language summary. Expanded desktop admin navigation hides its decorative icons while keeping the existing text labels; its collapsed state still has icons pending clarification of how all icon-only actions should be represented. Workspace/loader suites: 10 tests passed; admin navigation/drawer suites: 6 passed; scoped ESLint and diff check passed. Browser navigation to the catalogue timed out; visual check of this icon change remains NOT_RUN. Removal across pages and replacement of icon-only controls are not complete.

Owner correction: improve icons and card interiors, rather than remove icons. The temporary navigation icon removals described immediately above were reversed; preserve functional icons and improve their consistency.

## Owner correction — icon and card refinement

Owner clarified that icons should be improved, not removed. Restored the temporary navigation icon removals; shell suites passed (6 tests). The six existing channel metrics now use a consistent internal hierarchy with 36px subtle icon holders, relevant existing channel/status icons, readable labels and 28px values. Values, warning, filters and recorded-state semantics are unchanged. Channel/stage-C suites: 12 tests passed; scoped ESLint and diff check passed. Current browser navigation timed out, so this revision needs an actual desktop visual check; it is not full page acceptance.

## Admin overview — card interior refinement

Refined the five existing overview cards with consistent 36px icon holders, 19px icons, 14px muted headings, 28px primary values and readable 13px explanatory text. Financial caveats, data sources and actions were not changed. Company count/navigation and admin navigation suites: 18 tests passed. The current local session redirected to sign-in; this revision still needs authenticated desktop visual, RTL/LTR and contrast verification.

## Customer dashboard — card interior refinement

The three existing conversation metrics retain their scoped values, descriptions and links. Their headers now pair a readable label with an appropriate existing icon in a subtle 36px holder; values use 28px/36px hierarchy. Four dashboard/billing suites: 40 tests passed after preserving direct value text expected by existing behavior tests; scoped ESLint and diff check passed. The local browser currently redirects to sign-in, so actual desktop appearance and RTL/LTR layout remain NOT_RUN.

## Admin billing — card interior refinement

The three existing billing summary cards now use consistent 36px icon holders and 28px count hierarchy; the confirmed amount breakdown and the explanations of page scope and uncertain states remain intact. Billing/stage-D suites: 11 tests passed; scoped ESLint and diff check passed. The authenticated local session is unavailable, so this revision still needs desktop visual/contrast verification; no financial action was performed.

## Customer knowledge — approval card

The workspace-only approval summary now has a neutral document icon, 24px desktop padding and a restrained card shadow. When approval evidence is unavailable its existing text uses a warning surface rather than a success-colored badge; no approval, source or readiness calculation changed. The controls-regression suite ran 18 tests successfully; scoped ESLint and diff check passed. Two other supplied Vitest filter names matched no test files and are not counted. Desktop visual, real source-edit/approval and English acceptance remain NOT_RUN because the local session is not authenticated.

## Platform settings — desktop card refinement

The reference-values, unverified operational-status and reference-job sections now have consistent neutral icons, 24px desktop padding, 12px radii and a normal card shadow. Read-only and unverified explanations remain unchanged; no setting or worker was modified. Platform-settings/stage-D suites: 5 tests passed; scoped ESLint and diff check passed. Authenticated browser appearance and English layout remain NOT_RUN.

## Customer dashboard — subscription card

The existing subscription/usage card now has a neutral billing icon and consistent 28px value hierarchy; the facts are separated by light rules and dates are direction-isolated. Existing unavailable, eligibility, quota, refresh and navigation behavior was retained. Four dashboard/billing suites: 40 tests passed; scoped ESLint and diff check passed. No payment action was performed. Authenticated desktop visual and full billing journey remain NOT_RUN.

## Admin platform health — metric card interiors

The four existing limited-probe cards now use consistent neutral icon holders, 14px headings, 20px padding and restrained shadows. Their recorded/unverified text and probe logic are unchanged; neutral icon color is not a health signal. Health and refresh suites: 8 tests passed. No probe was run against a provider; authenticated desktop visual and actual runtime acceptance remain NOT_RUN.

## Admin operations and inventory update

The four existing operations summary cards now use consistent neutral icon holders, readable headings, 20px padding and restrained shadows; values, probe scope, warnings and filters remain unchanged. Operations suite: 6 tests passed. No probe or provider action was run. Desktop visual and authenticated acceptance remain NOT_RUN. The coverage table was also enriched from the current route-entry imports for 35 paths; these names locate entry components only and are not a complete inventory of their nested controls, role gates or states.

## WhatsApp inbox — wide desktop customer context

At viewport widths of at least 1440px, the embedded WhatsApp pane now allocates a 280px inline customer-details column when a conversation is selected; narrower widths retain the existing drawer. Resizing from drawer mode to the wide layout closes the modal state. Existing selected conversation, customer details, send and takeover logic remain. Three relevant background-read, inbox and safety suites: 21 tests passed; scoped ESLint and diff check passed. The initial test invocation also ran the existing details/safety suites (8 tests); one supplied filename did not exist and is not counted. No real conversation was opened or message sent. The actual wide layout, transition, focus and RTL/LTR remain NOT_RUN in an authenticated browser; Instagram still uses its existing drawer and requires separate design work.

## Instagram inbox — wide desktop customer context

The embedded Instagram thread now reserves a 280px details column at viewport widths of at least 1440px, matching the WhatsApp wide layout. The existing details drawer remains at narrower widths; resizing to wide closes its modal state. Assignment, drafts, send guards and channel data were not changed. Instagram, details panel and unified-inbox safety suites: 21 tests passed; scoped ESLint and diff check passed. These tests do not directly establish the new breakpoint/resize behavior; authenticated desktop visual, focus and RTL/LTR validation remain NOT_RUN. No message or assignment action was performed.

## Inbox message readability — desktop

Instagram message bubbles now use the specified 72% maximum desktop width, wrap long content, and show sender/time at 12px; the unified conversation row has a 76px minimum height and may grow. Existing direction, content, selection, scroll and send behavior were not changed. Instagram, unified-safety and WhatsApp inbox suites: 31 tests passed. This checks existing behavior, not rendered dimensions or wide-column focus; authenticated desktop visual and real-message acceptance remain NOT_RUN.

## Admin support — summary cards

The four existing support summary cards now have consistent neutral icon holders, 14px headings, 20px padding and normal shadows; long content may wrap. Ticket counts, unknown states and actions are unchanged. Support suite: 6 tests passed. Actual desktop appearance and populated interactions remain NOT_RUN; no ticket or review action was performed.

## Inbox breakpoint — synthetic browser evidence

Ran a local headless Chrome fixture using the current `service-theme.css` and representative channel markup. At 1439px both customer-detail panels were hidden and their toggles visible; at 1440px WhatsApp and Instagram panels rendered with 280px detail columns and hidden toggles. This is computed-CSS evidence only: it does not exercise the React state transition, focus, actual message content, authentication or production. Script in this chat workspace `work/inbox-breakpoints.py`; no repository route or customer data was created.

## Customer dashboard — pointer highlight

Interactive conversation KPI links now have a subtle cursor-positioned highlight only on fine-pointer hover when reduced motion is not requested. Pointer coordinates update CSS properties without React state; navigation and values remain unchanged. The new pointer test failed before implementation, then dashboard suites passed 22 tests; scoped ESLint and diff check passed. A synthetic headless Chrome CSS fixture showed the radial highlight on hover and no background image with reduced motion. Actual authenticated dashboard visual and performance remain NOT_RUN; the highlight does not run while no pointer moves.

## Panel typography — local implementation

Added locally served Inter Variable 4.1 and registered the existing IBM Plex Sans Arabic regular/medium/bold files with `font-display: swap`, scoped font selection to the admin and internal workspace/setup boundaries, and reset Arabic letter spacing within those boundaries. The public page retains its existing Tajawal selection. Inter and IBM Plex OFL texts are saved alongside the font files. A local headless Chrome fixture loaded both font families successfully, and the compiled local CSS exposed all four registered faces. Workspace/admin/setup suites: 26 tests passed. This verifies font availability, not actual rendered glyph choice, layout, bundle impact or authenticated desktop acceptance. The currently available browser control reports disabled in Work settings; no live visual check was possible in this turn.

## Admin AI model cards — desktop refinement

The existing non-interactive model cards no longer change border on hover as if clickable. Their titles, usage labels and numeric values have clearer alignment and sizing; summary icons use the same restrained holder as other cards. Data, provider actions and unavailable values remain unchanged. AI operations, access-refresh and motion suites: 9 tests passed; scoped ESLint and diff check passed. Authenticated desktop visual and real provider journeys remain NOT_RUN.

## Customer branch card — desktop refinement

The existing branch and channels card now uses the shared header icon treatment and recognizable WhatsApp/Instagram icons beside the existing labels. Launch confirmation, channel evidence, data reads and setup links are unchanged. Three dashboard suites: 22 tests passed; scoped ESLint and diff check passed. Authenticated desktop visual, contrast and actual channel journeys remain NOT_RUN.

## Customer settings — account context

The existing signed-account, company and role summary now has distinct, consistently sized icons and direction isolation for the business name. Values, role checks, company switching and save handlers are unchanged. Controls, settings route and subscription-navigation suites: 43 tests passed; scoped ESLint passed. Authenticated desktop rendering and company switching remain NOT_RUN.

## Subscription offers — account surface

Scoped the existing standard offer cards within the account subscription panel to white V2 surfaces, 12px radii, restrained shadows, 18px titles, 28px prices and 8px controls; removed the non-interactive hover lift and backdrop blur. Public pricing styles, catalogue values, selection and checkout logic were not changed. Four catalogue/layout/checkout/readiness suites: 23 tests passed; diff check passed. This does not cover the separate `homepageStyle` account card variant or an authenticated visual/checkout journey, both still NOT_RUN.

## Subscription account cards — alternate presentation

Refined the existing account-only persona card panel with 12px corners, a light border/shadow, 28px pricing, readable 13px status notes and 44px controls. The selected state remains explicit; content, images, catalogue data and purchase actions remain unchanged. Three catalogue/layout/account-summary suites: 16 tests passed; diff check passed. Browser layout, long text, RTL/LTR and full checkout remain NOT_RUN; this change does not alter the public homepage.

## Shared panel controls

Scoped shared buttons in internal workspace, setup and admin surfaces now use 8px corners, 14px semibold text and an explicit focus-visible outline; secondary buttons have a white surface and light border. Entry/auth styling remains excluded, and controls keep a 44px minimum target. Four controls/navigation/setup suites: 44 tests passed before the final CSS-only minimum-height adjustment from 40px to 44px; diff check passed. Actual browser focus/contrast and all page-specific control variants remain NOT_RUN.


## Magic UI and shared service tokens synchronization

Synchronized core `--service-*` tokens across `.app-shell` and `[data-service-theme]` in `src/components/app/service-theme.css` to match V2 specification values: `--service-canvas: #ffffff`, `--service-ink: #172b28`, `--service-muted: #536762`, `--service-line: #dfe7e4`, `--service-accent: #147d73`, and `--service-accent-hover: #11665f`.

Implemented pure CSS/React Magic UI solutions in `src/components/app/magic-ui.tsx` and `magic-ui.module.css`:
- `MagicCard`: fine-pointer spotlight tracking (`--spot-x`, `--spot-y`) + interactive hover lift (`translateY(-2px)`) and elevated shadow (`0 8px 24px rgba(15,23,42,.09)`), honoring `prefers-reduced-motion`.
- `BorderBeam`: perimeter border beam with `IntersectionObserver` pause on off-screen/hidden tab.
- `BentoGrid` & `BentoCard`: asymmetric responsive layout container (12 desktop / 6 tablet / 1 mobile).
- `AnimatedBeamConnection`: animated flow beam between channel nodes and AI processing, integrated in Instagram connection (`/app/instagram`) and Platform Channels Hub (`/admin/channels`).
- Upgraded quick action tools in `/app` and overview cards in Admin (`/admin`, `/admin/operations`, `/admin/health`, `/admin/support`, `/admin/billing`) to V2 Action Cards with hover lift and pointer spotlight.
- Unit test suite `src/components/app/magic-ui.test.tsx`: 4 tests passed; cross-surface suite run passed (40 tests). Live browser verification remains open.

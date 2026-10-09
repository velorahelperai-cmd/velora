# Velora — تحديث تدقيق الرحلة للاستيراد اليدوي إلى NotebookLM

تاريخ المراجعة: 2026-10-09، Asia/Muscat. الأداة: Codex، الدور: مراجعة المصدر وتقييم أدوات الاختبار؛ لا اعتماد إنتاج.

## نطاق الأدلة

- المصدر المراجع: `origin/main` عند `667f88d9cf0dea4945981d3913345db0bde5602d`، وهو أساس فرع `codex/remainders-validation`. كود المنتج في فرع التقييم مطابق لهذا الأساس.
- التقرير الأصلي: `artifacts/audit/VELORA-COMPLETE-BUSINESS-TECHNICAL-JOURNEY-AUDIT-2026-10-09.md`، أساسه القديم `31f1fc04052e255f95f948a7c57f60588bd25c37`. احتُفظ به دون استبدال أو تعديل.
- النسخة المستقلة: `C:/Users/DELL/.codex/preserved/velora-remainders-2026-10-09-83a2308a`؛ `manifest.json` يسجل SHA-256 للملفات الخمسة. التطابق عند الحفظ: 5/5.
- **مؤكد بالمصدر** يعني وجود التنفيذ وفحص مساره؛ لا يعني تفعيله أو إثبات تعريفات Supabase Cloud. **تاريخي** يعني نتيجة موثقة قبل هذه المهمة ولم تُعد هنا. **محلي جديد** يعني تشغيلًا في بيئة هذه المهمة فقط.
- لم تُقرأ السحابة، ولم يُختبر دفع أو تفويض Meta أو نموذج حقيقي. لا تعديل لمصادر NotebookLM، ولا خطة تطوير موازية.

## الموجود فعليًا

| المجال | الحالة المثبتة | دليل المصدر |
|---|---|---|
| الحساب والشركة | Auth، profile، عضوية owner، وحراسة سياق الشركة؛ ليست بيانات واجهة ثابتة | `src/lib/tenancy/actions.ts:149,194,320`؛ `src/lib/tenancy/access.ts:220` |
| المعرفة | حفظ نص/مصادر، نسخ واعتماد owner، واسترجاع معرفة الشركة والتحقق من نسخ الاستشهادات | `src/lib/knowledge/actions.ts:1091`؛ `src/lib/answers/context.ts:146,230,242` |
| الإدارة والصلاحيات | platform owner/delegated، grants/scopes؛ ليست عضوية شركة تلقائية | `src/lib/access/actions.ts:173,290` |
| Unified Inbox | صفحات محادثات ورسائل، read markers، تحكم بشري؛ الرد اليدوي محمي بالاستحقاق المدفوع | `src/lib/whatsapp/inbox-contracts.ts:104,116,130`؛ `src/lib/whatsapp/actions.ts:189,701` |
| المالية | مؤشرات قراءة مرتبطة بأدلة تحصيل واستحقاق مؤهلة، مع فصل Test/Live | `src/lib/billing/financial-truth.ts:64,84,93,109`؛ `src/lib/billing/financial-read.ts:60,82,97` |
| محرك AI وWhatsApp | RPCs للحجز والتسوية، approved knowledge، ربط Meta/Vault، inbound jobs/outbound intents؛ التشغيل الحي محكوم بحواجز مستقلة | `src/lib/answers/runtime/store.ts:23,31`؛ `src/lib/whatsapp/integration-store.ts:13,37,51`؛ `src/lib/whatsapp/embedded-signup-meta.ts:50,58,68` |

## إعادة تقييم ملاحظات التقرير القديم

| الملاحظة | الحكم المحدث على main | الدليل/حدود الحكم |
|---|---|---|
| G01 — السحابة والجلسات | **غير متحقق سحابيًا**؛ لا يجوز استنتاج mismatch من عدد migrations. تفعيل حراسة SQL يعتمد على setting مستقل | `supabase/migrations/20261008010000_vel_session_idle_policy.sql:3,44,58`؛ لا قراءة Cloud في هذه المهمة |
| G02 — Checkout الحقيقي | **محجوب عمدًا/غير متحقق خارجيًا**؛ المسار الحالي Test، ويرفض Live ويتطلب اعتماد تحويل OMR | `src/lib/billing/wiring/test-checkout.ts:8,11,16`؛ `order-actions.ts:116,333` |
| G03 — تجربة العميل والمراجعة | **عيب رحلة مفتوح**: AnswerProvider يرجع null؛ المراجعة تشترط نجاح التجربة المحلية، فيتوقف العميل الجديد. تفعيل AI ليس إصلاحًا لأداة اختبار | `src/lib/answers/provider.ts:11,12`؛ `guards.ts:20`؛ `runtime-setup.ts:17`؛ `src/components/app/setup-wizard.tsx:676,1507,1747` |
| G04 — Worker الحي | **غير مفعّل/تشغيل الإنتاج غير متحقق**؛ endpoint لا يثبت Scheduler أو مراقبة تشغيل | `src/lib/whatsapp/integration-store.ts:13`؛ `src/app/api/internal/whatsapp/worker/route.ts:15,20,21` |
| G05 — Meta | **تنفيذ Cloud API موجود**؛ OAuth الحقيقي وملكية الرقم وموافقة التطبيق والتسليم الخارجي لم تُختبر هنا | `src/lib/whatsapp/embedded-signup-meta.ts:50,58,61,70`؛ `embedded-signup-actions.ts:38` |
| G06 — ميزانيات AI | **الحجز المحمي موجود**؛ provisioning والعمليات الفعلية لكل شركة غير متحققة؛ سقف تجربة الأدمن منفصل | `supabase/migrations/20261008133000_vel_ai_whatsapp_reservation_integration.sql:189,191,203`؛ ترحيل `20261008160000_vel_ai_security_accounting_boundary.sql:6,48`؛ `src/components/app/admin-ai-console.tsx:26` |
| G07 — صدق حالة الدفع والإيراد | **مصحح في main**؛ لا يكفي grant؛ gross مميز عن net، والrefund الجزئي لا يخترع مبلغًا مستردًا | `financial-truth.ts:64,93,109`؛ `wiring/return-status.ts:50,52`؛ `financial-read.ts:78,82`؛ `src/components/app/admin-list.tsx:514,524,529` |
| G08 — onboarding الموظف | **جزئي**؛ قبول الدعوة ينشئ عضوية دون grants جديدة. لا تجاوز أمني؛ يلزم منح مخول قبل التشغيل | `supabase/migrations/20261008070000_vel_staff_invitations.sql:113,114,118`؛ `20261006120000_vel_access_management_01.sql:362,367`؛ `src/lib/access/actions.ts:173` |
| G09 — التجديد/الترقية/السنوي | **نطاق تجاري جزئي**؛ وجود helpers وعرض الباقات لا يثبت رحلة شراء كاملة | `src/lib/billing/wiring/renew-gate.ts:17`؛ `order-actions.ts:97,251`؛ `src/lib/billing/catalog-backend/contract.ts:5,12`؛ `src/components/app/subscription-offers-view.ts:84` |
| G10 — رحلة كل الأدوار | **فجوة تحقق**؛ HTTP المحلي لهذه المهمة لا يغطي قبول موظف→grant→reply→revoke ولا بيئة النشر | `src/lib/whatsapp/company-journey-postgres.test.ts:12,14,89,90` يستخدم SQL adapters ومزودين وهميين؛ حدود التغطية أدناه |
| G11 — المصالحة التشغيلية | **جزئي**؛ retry/reconcile primitives موجودة؛ لا دليل تشغيل خدمة مراقبة ومصالحة كاملة | `src/lib/whatsapp/integration-worker.ts:26,69`؛ worker route:15؛ ترحيل AI reservations:392 |
| G12 — تباين الإعداد | **عيب مصدر مفتوح**؛ نصوص فاتحة ثابتة فوق panels فاتحة؛ لا تغيير تصميم في هذه المهمة | `src/app/globals.css:145,172`؛ `src/components/app/setup-wizard.tsx:454,477,481,934` |
| G13 — ERP/POS/stock/invoices | **نطاق غير منفذ**؛ knowledge facts والتعليمات ليست تنفيذ إجراءات تجارية | `src/lib/knowledge/actions.ts:421,483,1091`؛ `src/components/app/admin-list.tsx:1072,1083,1138` |
| G14 — coexistence/history | **غير مدعوم صراحة**؛ لا وعد بإبقاء Business App واستيراد التاريخ | `src/lib/whatsapp/embedded-signup-actions.ts:40`؛ `embedded-signup-meta.ts:58`؛ `src/components/app/whatsapp-embedded-signup.tsx:44` |
| G15 — سياسة inbound retention | **ربط غير مكتمل بالمصدر**؛ helper للحصة/النافذة موجود، ومسار store_meta_inbound لا يستدعيه. ليس إثبات تسريب أو قرار سياسة جديد | `src/lib/billing/inbound-retention.ts:51,57,62,70`؛ `supabase/migrations/20261008143000_vel_meta_routing_send_policy.sql:58,63,67`؛ webhook route:118,129 |
| G16 — سياق الشركة القديم | **مصحح في main** للدعوات وMeta؛ الخادم يعيد التحقق من company_id ولا يعتمد تبويبًا قديمًا | `src/components/app/settings.tsx:324`؛ `src/lib/tenancy/staff-invitations.ts:33,41`؛ `src/lib/whatsapp/embedded-signup-actions.ts:16,24,32,59` |
| G17 — helpdesk/notifications/export | **نطاق جزئي/مؤجل**؛ review/intervention/audit موجودة، وليست منظومة support/export كاملة | `src/lib/tenancy/actions.ts:567,590`؛ `src/lib/whatsapp/inbox-contracts.ts:12,140`؛ `src/components/app/admin-list.tsx:1072` |

## النتائج الحالية والقديمة

- النتائج الجديدة: **7 اختبارات عزل PASS، 16 فحص متصفح للعميل + فحص نشر باقة للأدمن PASS، ونجاح تنفيذي prepare/answer لنفس اختبار التكامل opt-in على PostgreSQL الحقيقي، و71/71 ترحيل محلي PASS، وTypeScript/Lint PASS**. التشغيل النهائي exit 0؛ عمليات الدفع الحقيقي وMeta الحقيقي وتجربة العميل وطلب المراجعة تظل **4 BLOCKED**. التفاصيل في `docs/integration/remainders-validation.md`، منفصلة عن المحاولات الفاشلة السابقة والنتائج التاريخية. لا تُحسب المحجوبات ناجحة.
- G07 لديه **دليل PostgreSQL تاريخي: 2 PASS**، منفصل عن اختبارات HTTP الجديدة: `docs/integration/g07-financial-truth-report.md:45,63`. لم يُعد تشغيل G07 SQL هنا لمجرد تحديث التقرير.
- `preview-smoke.mjs` في main يختبر صفحات عامة/anonymous فقط. `company-journey-postgres.test.ts` يستخدم نقل SQL بديلًا عن Supabase HTTP. لذلك لا يعوضان بالكامل اختبارات GoTrue/PostgREST/Browser الجديدة، رغم اشتراكهما في بعض حالات الأعمال.
- PostgreSQL المحلي، وسلسلة migrations الناجحة، لا يثبتان مطابقة Supabase Cloud أو اكتمال Storage أو إعدادات الإنتاج.
- ثبت محليًا حفظ الرد الوهمي والحصة والتكلفة وعرضه في Inbox، ومنع قراءة شركة أخرى وCRUD المباشر للحسابات المالية، ثم استلام الموظف/المالك للمحادثة مع حفظ المحاسبة. هذا تحقق نقل HTTP وخلفية فعلية بحدود مزودين وهمية؛ ليس نجاح Meta/AI مدفوعًا أو تسليم WhatsApp حقيقيًا.

## العيوب التي تستلزم مهمة مستقلة

1. **G03**: حساب صناعي جديد → شركة ومعرفة معتمدة → `/app/test` يرجع NEEDS_SETUP → `/setup` محطة Go-Live تمنع إرسال طلب المراجعة لعدم نجاح التجربة. يُحفظ الحجب؛ لا تبديل مزود أو تفعيل AI ضمن تقييم الأدوات.
2. **G15**: إثبات تطبيقي لاحق لمسار inbound retention وتحديد السياسة المعتمدة؛ لا تعديل billing أو صلاحيات أو migration هنا.
3. **G12**: إصلاح تباين التصميم في مهمة UI منفصلة. اكتمال محركات الخلفية لا يزيل هذا العيب.

## ملاحظة محلية جديدة — UI-NAV-01

**FAIL مُلاحظ، والسبب الجذري UNVERIFIED**: بعد الرجوع من `/app/test` إلى `/setup` والنقر على محطة Go-Live، انتهت محاولة محلية بمهلة انتظار زر المراجعة، والواجهة بقيت عند Subscription Plan (المحطة 2). نجح الانتقال في محاولات أخرى؛ لذلك لا يُعامل النجاح الأخير وحده كإغلاق للملاحظة. الدليل: `artifacts/local-http-browser-journey/f79990e3/browser-setup-review-remains-disabled-failed.png` ونتيجة التشغيل المرحلية. الصورة أيضاً تؤكد التباين الضعيف المذكور في G12.

المصدر الذي يلزم فحصه عند إعادة الإنتاج المستقلة: `src/components/app/setup-wizard.tsx:211,304,342,430`؛ هناك استعادة للخطوة من أول milestone غير مكتمل، وتحديث الخطوة من النقر. ارتباط الفشل بتوقيت استعادة الحالة أو بيانات الخادم **فرضية تحتاج إثباتاً**، وليس تشخيصاً نهائياً. ظهور HTML قبل ربط الأحداث أيضاً احتمال تؤكده آلية Next الموثقة محلياً؛ أداة الاختبار تنتظر الآن ربط الحدث قبل النقرة الواحدة، ولم تعدّل المنتج. لا إعادة نقر تخفي الفشل. أداة التقييم توفر `--record-setup-navigation-failure` لاحتفاظها بـFAIL وexit 1 عند تكراره، مع استكمال اختبارات worker المستقلة فقط. لا تُصنّف هذه الملاحظة عيب منتج مؤكدًا قبل إعادة الإنتاج بعد انتظار التفاعل.

هذا تحديث أدلة قابل للاستيراد اليدوي إلى NotebookLM، وليس اعتمادًا من Antigravity أو إعلان جاهزية Staging/Production.

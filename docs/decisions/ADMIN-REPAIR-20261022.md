# ADMIN-REPAIR-20261022 — عقود للمراجعة ونطاق التنفيذ

- الحالة: PROPOSED / Needs Decision؛ ليست قواعد تشغيل أو تفويض تطبيق.
- مرجع القواعد الوحيد: [VELORA_RULES.md](../../VELORA_RULES.md).
- المصدر: تكليفات المالك في 2026-10-22. خصّص ملفات الدعم لـCodex، واختار إعداد الأدوار الجديدة للمراجعة. Antigravity يتولى Stage G للمتصفح والأداء والمظهر؛ لا نكرر حزمة قبوله.
- لا Production Migration أو Commit أو Push أو مكالمات مدفوعة ضمن هذه الحزمة.

## SUPPORT-01 — التصحيح المحلي المُحضّر

المواضع: `src/lib/tenancy/support-actions.ts` و`support-types.ts` و`src/components/admin/admin-support-reviews.tsx` و`src/app/admin/support/page.tsx`.

السبب المثبت: مسار إنشاء التذكرة/الملاحظة يستخدم هوية مؤقتة بعد فشل الإدخال؛ التحديث يتجاهل نتيجة الحفظ؛ القراءة تتجاهل الخطأ وتفلتر الدفعة الأولى فقط. الجداول غير موجودة في قاعدة الهدف حسب فحص الكتالوج للقراءة فقط، والترحيل غير مسجل ضمن الترحيلات الـ97.

التصحيح المُحضّر: كل كتابة تستدعي `admin_support_mutate(uuid,text,jsonb,bigint)`، بمعرّف عملية وإصدار متوقع. النجاح يُقبل فقط بعد استجابة محفوظة صالحة ومطابقة للطلب؛ فقد الاتصال يبقى UNKNOWN دون إعادة تلقائية. تخزين التذكرة والملاحظة والتدقيق وإيصال العملية داخل معاملة واحدة. الواجهة تحتفظ بمعرّف المحاولة خلال بقاء النموذج مفتوحًا، وتعرض الخطأ دون Refresh. الاستعادة بعد إعادة تحميل المتصفح لا تزال تحتاج قبولًا منفصلًا؛ لا يُدّعى تحققها.

مصدر SQL للمراجعة فقط: `supabase/migrations/20261022100000_vel_support_tickets_review.sql`. أُعيد تحرير المسودة غير المطبقة بعد التحقق من غياب الجدولين والترحيل؛ لم يُعدّل ترحيل مسجل. يمنع تعارض البنية بإنشاء صارم دون IF NOT EXISTS، ويبقي RLS مفعّلًا.

تغييرات الصلاحيات المقترحة: الجدولان public.support_tickets وpublic.ticket_notes قابلان للقراءة فقط لـauthenticated بشرط حارس جلسة المالك الخادمي الموجود `billing_admin_authorized_session()`. لا كتابة مباشرة لـauthenticated، ولا وصول لـanon أو service_role. جدول إيصالات العمليات private.admin_support_operations محجوب مع RLS. RPC مملوك لـpostgres وsearch_path فارغ؛ EXECUTE لـauthenticated فقط مع حارس المالك داخل كل استدعاء وإعادة قراءة الإيصال. لا صلاحيات جديدة للمفوضين. الإسناد في هذه النسخة محصور في مالك نشط إلى أن يعتمد عقد الأدوار الجديدة.

السلامة: branch_id من نوع uuid، ومفتاح أجنبي مركب `(company_id,branch_id)` إلى `company_branches(company_id,id)`، دون CASCADE. التحديث يقفل التذكرة ويتحقق من revision، ثم يغيّر التذكرة والملاحظة والتدقيق معًا. إعادة نفس العملية تسترجع الإيصال؛ تغيير المدخلات بنفس المعرّف يعيد CONFLICT. حقول التدقيق لا تحتوي نصوص التذكرة أو الملاحظة أو عناوين الاتصال.

معايير القبول المتبقية: إدخال ثم قراءة فعلية بعد Refresh؛ فشل قيد الفرع أو الملاحظة أو التدقيق يلغي المعاملة كلها؛ تبويبان متزامنان ينتجان CONFLICT؛ إعادة عملية ناجحة أو مجهولة بنفس المعرّف لا تكرر الأثر؛ المجهول لا يُعاد تلقائيًا؛ عميل شركة أو مفوض أو جلسة منتهية لا يقرأ/يكتب؛ نتيجة محدودة الصفحات لا تخفي نتائج البحث. يلزم اختبار SQL أصلي في قاعدة اختبار مصرح بها ثم مراجعة الصلاحيات وبصمة الملف قبل أي تطبيق على الهدف. اختبارات Unit ليست دليل قبول قاعدة البيانات.

## AUDIT-01 — تنقيح العرض

`src/lib/tenancy/audit-redaction.ts` يحجب الهاتف والبريد والاسم والأسرار في البنية المتداخلة. النص الحر محجوب افتراضيًا؛ تُحفظ فقط قيم enum معروفة وUUIDs في حقول الهوية وطوابع زمنية صحيحة وأرقام/booleans غير موسومة كحساسة. لا نعتمد regex لتخمين أسرار غير معلومة داخل النص. هذا إسقاط للعرض؛ لا يغيّر السجلات المخزنة ولا يثبت التزام جميع منتجي السجلات أو حقول الرسائل الأخرى.

## ROLE-01 — مواصفات الأدوار الجديدة، غير معتمدة

العقد الحالي: platform_admins.role يقبل owner/delegated؛ platform_admin_scopes يربط المفوض بالشركة والصلاحيات وrevision. requirePlatformAdmin يحصر /admin بالمالك حاليًا. لا نحوله إلى دخول عام للمفوضين قبل اعتماد المصفوفة وتطبيق حراسها في الخادم وقاعدة البيانات.

التصميم الموصى به: الإبقاء على owner/delegated كهوية قاعدة، وإضافة ملف دور واحد لكل مفوض (support أو finance أو operations) بدل كتابة القيم الجديدة في عمود role الحالي. كل تعيين يحدد company_id، الصلاحيات المسموح استخدامها وتفويضها، الإصدار المتوقع، السبب والفاعل. لا نطاق كل الشركات ضمني، ولا جمع صلاحيات بين الأدوار تلقائيًا. التحكم في تعيين الأدوار وسحبها للمالك فقط، مع إيصال وتدقيق ومعاملة واحدة. إيقاف الدور يمنع التفويض في الطلب التالي؛ لا يُوصف بأنه تسجيل خروج للهوية ما لم يُنفذ إبطال الجلسات فعلًا.

- owner: الإدارة الحالية الكاملة مع ضوابط الدفع والمفاتيح والموافقات؛ لا تفويض ملكية من واجهة الأدوار.
- support المقترح: بحث العملاء والتذاكر والملاحظات داخل الشركات المعيّنة. عرض مراجعات التجهيز؛ قرار القبول/الرفض يظل للمالك إلى أن يعتمد خلافه. لا تسويات أو استرداد أو مفاتيح أو إعداد مزودي الذكاء.
- finance المقترح: قراءة الاشتراكات والأوامر والتحصيل المثبت وكتالوج الأسعار للشركات المعيّنة. لا تأكيد دفع أو منح رصيد أو استرداد أو تغيير أسعار أو إدارة مشرفين. التقارير الشاملة لكل الشركات تحتاج تفويضًا صريحًا منفصلًا.
- operations المقترح: قراءة التشخيص الآمن ومعرّفات التتبع والصحة ضمن نطاقه. لا رسائل العملاء أو payload خام أو أسرار أو بيانات دفع، ولا تشغيل عوامل أو إعادة إرسال أو تغيير سياسات.

الحراس المطلوبة: السماح بالـlayout عند وجود دور صالح فقط بعد اعتماد التصميم؛ حارس صفحة وحارس DAL وحارس RPC لكل قدرة/شركة، مع قراءة حالة الدور الحالية وعدم الاعتماد على user_metadata أو إخفاء الأزرار. خريطة تنقل بحسب القدرات؛ الرفض خادمي حتى مع استدعاء Server Action مباشر. القدرات غير الموجودة في SQL الحالي تحتاج ترحيلًا مُراجعًا، دون منح platform.manage_admins أو platform.manage_access للأدوار العادية.

قبول الأدوار: مصفوفة owner/support/finance/operations ضد صفحات الإدارة وServer Actions وRPCs مباشرة؛ منع رفع الصلاحية والقراءة بين شركتين؛ سحب الدور أثناء جلسة مفتوحة؛ تعارض تعديلين بالإصدار؛ فشل كتابة التدقيق يلغي التغيير. قبل تعديل الواجهة يلزم brief وmockup واعتماد بصري. ما سبق توصية للمراجعة ولا يثبت اعتماد الأدوار أو أي سياسة تجارية جديدة.

## SETTINGS-01 — التخزين والسياسات، مؤجل لقرار

الحفظ الوهمي أُوقف؛ يرجع PLATFORM_POLICY_STORAGE_UNCONFIGURED. القيم المعروضة مرجعية وليست بيانات مقروءة من تخزين معتمد. يلزم صف إعدادات versioned، وRPC للمالك يقرأ/يكتب بقفل إصدار وتدقيق ذرّي، ثم توصيل المستهلكين الفعليين للإعداد. الـ48 ساعة و80% وحد 100 طلب ليست سياسات مثبتة بمجرد وجودها في الواجهة؛ يلزم سند اعتماد ومطابقة المستهلكين قبل التفعيل. لا نضيف جدولًا عامًا مفتوحًا لتجاوز هذه الخطوة.

## OPS-01 — مصدر التصحيح المحلي، مع بقاء فجوة التتبع

المواضع: `src/lib/tenancy/operations-actions.ts` و`operations-types.ts`، ثم نقطة `src/app/api/internal/whatsapp/worker/route.ts` كتصحيح مراقبة منفصل خارج الصفحة.

السبب المثبت من المصدر: قراءة instagram_webhook_receipts بالمخطط الافتراضي، تجاهل أخطاء القراءة، تصنيع traceId/requestId، و100% لوجود سجلات دون عد الإخفاقات أو تحديد نافذة، وتجميع Paymob في دليل سلامة Meta. حالة الذكاء المبنية على وجود مفتاح ليست دليل تشغيل أيضًا.

المُحضّر: `supabase/migrations/20261022073239_vel_admin_operations_safe_diagnostics_review.sql` (أنشأه Supabase CLI؛ REVIEW ONLY / NOT APPLIED) يعرّف `admin_read_operations_snapshot(text,text,text)`، وملف operations-actions يستدعيه بدل قراءة الجدول الخاص مباشرة. RPC تشخيص owner-only محدود المدى والعدد يعرض metadata آمنة من الجداول الفعلية بما فيها private، دون منح SELECT مباشر للمخطط الخاص أو إعادة payload/أرقام عملاء/معرفات مزود حساسة. استخدام request_id/trace_id الأصليين فقط؛ إذا لم يسجلهما منتج الحدث فالقيمة UNKNOWN مع تسجيل فجوة التوصيل. القيم القديمة لا تُحوّل إلى معرّفات تتبع مزعومة. الفلاتر والعد والنافذة في الخادم؛ تقييم كل قناة من دليلها، ولا يُعرض معدل استقبال إن لم تُرصد كل النجاحات والإخفاقات. غياب السجلات أو فشل الوصول حالتان منفصلتان.

العامل: نُفّذ `src/lib/whatsapp/worker-observation.ts` ووُصل بنقطة التشغيل. HTTP 202 للتعليق أو UNKNOWN، و503 للفشل المؤكد، مع code وعدادات وأكواد مدرجة فقط دون النص الخام؛ منطق الإرسال والتسوية لم يتغير. إسقاط مراقبة آمن لعدادات completed وaccepted وaccounting_pending وunknown وfailed، من حالات IntegrationOutcome الفعلية. لا يُوصف المقبول بأنه مُحاسَب أو مُسلّم؛ لا توكن أو معرّف عميل في الاستجابة. يلزم قبول هذه الدلالة مع المراقب/المجدول الفعلي ضمن Stage G؛ لا تغيير لمنطق الحجز/التسوية/الإرسال أو إعادة محاولة UNKNOWN.

## ES02-KNOWLEDGE-01 — طلب لاحق خارج الأدمن الحالي

المواضع: paid-setup-step-host.tsx، paid-branch-knowledge.tsx، paid-branch-knowledge-actions.ts، ودالة es02_page_action_owned_branch_knowledge.

تأكيد المصدر: الفريق snapshot=null/unavailable دون ربط؛ onUploadFiles/onSaveText غير موصلين؛ pageVersion لا تصل RPC؛ SQL يحدث الصفحة دون مقارنة نسخة ويحذف تأكيد الإطلاق حتى عند صفر صفوف. يلزم أولًا حصر RPCs المعتمدة للفريق والرفع والحفظ وحقوقها ثم توصيلها دون اختراع عقود أو UI جديد. يُنفّذ تصحيح النسخة/الصف في معاملة واحدة قبل أي حذف لتأكيد الإطلاق؛ الصفحة الغائبة أو القديمة أو الحالة غير المسموحة تعيد NOT_FOUND/CONFLICT دون أثر.

الحزمة المطبّقة 20261022062222 وبصمتها a81eccfa37a256f9acd609de4d2c08a4ffa0d438acec31efdb39a323759a8d6f محفوظتان دون تعديل أو إعادة تطبيق. أي تصحيح يحتاج ترحيلًا جديدًا متوافقًا مع المستهلكين، وفحص توقيع الدالة وEXECUTE واختبارات تبويبين/صفحة غائبة/حفظ ثم قراءة. لا تغيير حارس LOCAL ONLY أو ACL أو تأكيد إطلاق على Production ضمن هذا التوثيق.

## المصادر والحدود

- Next.js: https://nextjs.org/docs/messages/invalid-use-server-value
- Supabase select/count: https://supabase.com/docs/reference/javascript/select
- Supabase RPC: https://supabase.com/docs/reference/javascript/rpc
- فحص قاعدة الهدف في هذه الجلسة: سجل الترحيلات والكتالوج فقط، دون بيانات عملاء أو كتابات. لا قبول تشغيلي مستنتج من ذلك.
- الأدلة والأوامر والمانع الحالي تُسجل في PROJECT_STATE.md. لا ادعاء Production Ready أو اعتماد قاعدة/أدوار/سياسات من هذا المقترح.

## نتيجة التحقق المحلي المحدود

آخر مجموعة Unit مُنفّذة: 60 PASS / 0 FAIL في 7 ملفات، عبر vitest.ci.config.ts وبيئة isolatedEnvironment مع offline-network-guard وبدون ملفات .env أو متصفح أو قاعدة أو مزود فعلي. تشمل عقود الدعم، عرض الدعم، تنقيح التدقيق، عقود التشخيص، ملخص العامل ونقطة POST، وانحدار integration-worker بمنفذاته الاصطناعية. هذه اختبارات منطق/عقود وليست دليل قبول End-to-End.

ESLint المحدود للملفات المتغيرة PASS. فحص الأنواع العام يفشل حاليًا في ملف operational-lifecycles.test.ts غير المخصص لـCodex بسبب owner خارج نوع دور المنح، وnotes بدل note. لا نضعف العقود أو نعدّل ملف وكيل آخر بالتزامن لإخفاء هذا الفشل. البناء الذي نجح سابقًا يخص نقطة سابقة قبل حزمة الدعم والعمليات الحالية؛ لا يُنسب إلى المرشح الجديد.

التطبيق والتدقيق الذرّي وRLS والعزل ومفاتيح الفرع في SQL: NOT_RUN_NATIVE / NOT_APPLIED. لم تُختبر استمرارية الحفظ فعليًا على Supabase أو الاستعادة بعد Refresh أو صلاحيات الأدوار الجديدة. فحوص Stage G والواجهة/الأداء لدى Antigravity، ولا تمنح هذه النتيجة قبولًا للوحدات الـ14.

الأمر الفعلي المنفذ داخل غلاف Node الذي يستدعي isolatedEnvironment() وassertNoRuntimeEnvFiles() ويحمّل scripts/ci/offline-network-guard.cjs:

```text
node node_modules/vitest/vitest.mjs run --config vitest.ci.config.ts src/lib/tenancy/support-contracts.test.ts src/lib/tenancy/audit-redaction.test.ts src/components/admin/admin-support-reviews.test.tsx src/lib/tenancy/operations-contracts.test.ts src/lib/whatsapp/worker-observation.test.ts src/app/api/internal/whatsapp/worker/route.test.ts src/lib/whatsapp/integration-worker.test.ts --maxWorkers=1 --reporter=dot
```

النتيجة الأخيرة: 7 ملفات / 60 اختبار PASS / exit 0. الأمر node scripts/ci/run.mjs typecheck أعاد exit 1 لخطأي operational-lifecycles.test.ts عند السطرين 413 و434 في آخر تشغيل. ESLint للملفات المعدلة وgit diff --check المحدود نجحا. لا Build جديد بعد إخفاق بوابة الأنواع؛ آخر Build ناجح سابق على هذه الحزمة.
# ES02 follow-up — 22 October, source only

## OPS continuation: repair-only status and proposed durable tracing

### Local ingress foundation implemented after owner continuation

New `src/lib/logging/ingress-observation.ts` creates a server UUID root per HTTP POST and records started/finished/exception without accepting correlation headers or inspecting the body. `ingress-observation-server.ts` uses existing structured log context and a 500ms-aborted RPC per phase, no retry, and preserves the original handler response or thrown error. HTTP handler latency is measured separately from recorder delay (up to two500ms waits when persistence is enabled). Instrumented the existing WhatsApp/Instagram/Paymob POST routes only; HMAC, tenant resolution, entitlement processing and provider acknowledgements remain inside the original handlers. Existing provider diagnostic console calls are not certified as fully context-aware by this wrapper.

CLI-created `20261022164405_ops_ingress_observation_review.sql`, SHA256 `4b1f57c0627f2483f03b3361ac5a117bac5b0d501291091c8fc8de0bdae756e7`: private append-only attempt metadata with RLS and no direct client/service-role table access; service-role-only writer; native-owner/session-only bounded reader. A per-request advisory lock prevents conflicting terminal outcomes, source rebinding and non-idempotent overwrites. No payload, customer binding, provider identifiers or secrets accepted. `adminGetOperationsOverview` reads these genuine request contexts when rollout is enabled, validates the v1 envelope via `ingress-projection.ts`, and keeps old unmeasured evidence UNKNOWN. SQL filters request/service/severity before limit100; telemetry is not added to business-record counts. Coverage stays PARTIAL and ingress successRate UNKNOWN. The feature is off by default (`OPS_INGRESS_OBSERVATION_ENABLED` must explicitly equal true); no environment configuration changed. No fallback to direct private reads. No deployment effectiveness claimed.

Executed `node scripts/integration/ops-ingress-native-review.mjs` against the EXISTING local `velora-es02-b3-postgres-2964b85e` / `c1_ui_integration`, PostgreSQL17.6: actual SQL compiled; RLS/direct-grant/recorder-ACL/no-session checks, service-role synthetic metadata insert+idempotency, conflicting binding/terminal/result and null-status rejection, immutable update/delete checks PASS, followed by ROLLBACK and absence check PASS. Initial test-script replacement corrupted dollar quoting and failed; corrected function-form replacement and reran successfully. No permanent schema/data changes, new container, real Auth session or customer/provider data. Positive owner reader with a real session and concurrent independent database sessions remain NOT_RUN; an advisory lock is source evidence, not a proven two-session race test.

Offline Vitest scoped command (existing isolated CI wrapper, no environment files or network): ingress-observation, ingress-observation-server, ingress-projection, operations-contracts plus existing WhatsApp/Instagram/Paymob route suites:8 files/68 PASS. Added owner-consumer rollout/read-failure cases then reran operations-contracts:10 PASS. `node scripts/ci/run.mjs typecheck` PASS after projection/consumer implementation; scoped ESLint and git diff --check PASS. No Build/browser/provider execution. Source files modified: three webhook routes, operations-actions/operations-contracts; new logging helpers/tests, SQL and native review harness; state/decision docs. No new dependency, paid calls, Production migration, rollout config, commit/push/deploy.

NEXT remains active: versioned native ingress/job binding, duplicate-preserved business trace, claim projection and worker/settlement propagation. The new attempt-root trace is NOT that full business trace. Instagram/review/coexistence paths and Paymob native event binding need their exact native contracts verified before modification. Existing ES02/team/roles/policy decisions remain separately tracked. This foundation supersedes only the attempt-recorder portion of the proposal below; it does not claim that proposal complete. Official source: https://supabase.com/docs/guides/database/functions (function execution ACL and definer search_path). Changelog markdown index fetch failed with unsupported content type; no SDK/CLI upgrade attempted.

Confirmed source gap: `worker/route.ts` returned HTTP200 unconditionally when `workerRolloutEnabled()` was false, even if `whatsapp_repair_accepted_jobs` reported pending reconciliation. Corrected to202/RECONCILIATION_REQUIRED for pending>0; zero-pending remains200/CUSTOMER_ANSWERING_DISABLED. Neither path claims jobs or sends messages. Two focused route regressions cover both cases. Latest isolated/offline operations-contracts + worker-observation + worker route run: 3 files/20 PASS/0 FAIL; scoped ESLint PASS. This is not hosted/provider acceptance.

Proposed next contract for approval, NOT IMPLEMENTED: server-generated UUID request_id for each ingress attempt and a durable trace_id created at the first verified persisted event. Do not trust client correlation headers as authority. Native ingest transaction must save the trace binding alongside receipt/job and preserve the original trace on duplicate delivery. Each later worker execution gets a fresh request_id and carries the original trace_id from the claimed job; do not derive either from message/provider/customer/conversation IDs. Keep unknown historical rows unknown, without backfill or rewriting audit history.

Exact integration sites: `src/app/api/whatsapp/webhook/route.ts` -> `src/lib/whatsapp/store.ts` -> native `whatsapp_store_meta_inbound`/`save_whatsapp_inbound` and coexistence ingress; `src/app/api/instagram/webhook/route.ts` -> `src/lib/instagram/inbound-producer.ts` -> `instagram_ingest_signed_webhook`/review variant; worker claim projection -> integration ports -> worker lifecycle writes; Paymob separately through its canonical callback persistence. Preserve all HMAC/runtime/tenant/idempotency/financial invariants. Version the diagnostic RPC result rather than silently relaxing current NOT_RECORDED validation.

Needed permission decision: a private append-only diagnostic metadata store with RLS enabled and no direct public/anon/authenticated/service_role table access; a bounded, service_role-only recorder RPC for attempts/outcomes and an owner/session-only safe reader. Existing ingest/job RPCs need versioned trace arguments/result fields, retaining mandatory old-client rejection or compatibility that never invents context. This adds a new execution surface and needs explicit approval before implementation/application; no permission granted by this document. Store only generated IDs, source, fixed stage/code, timestamps, bound internal tenant ID after trusted resolution, and duration; no payload, headers, provider text, phone/email or credential material. Require native baseline fingerprints before designing wrappers; do not replace current SQL functions from stale packages.

Metric definition: report persisted/rejected/retry outcomes per actual observed ingress HTTP attempt within a stated UTC window. Provider-redelivery attempts count separately and are labeled attempts; business-event duplicates have a separate counter. A committed receipt is not proof of complete ingress. Recorder failures or missing observations must mark coverage PARTIAL and success rate UNKNOWN; bounded counters cannot truthfully claim visibility of requests that never reach the app. Do not treat bad signatures as authenticated tenant events. Acceptance requires valid/invalid signature, malformed body, duplicate/redelivery, failure before/after persistence, two concurrent attempts, resumed worker UNKNOWN/no resend, owner/non-owner read and recorder ACL denial, and cross-company binding checks. This is a proposed design, not a measured implementation.

The owner repeated the four ES02 findings. This follow-up does not duplicate Antigravity's Admin Stage G. `pageActionOwnedBranchKnowledgeAction` now validates and sends `p_expected_page_version`, requires the resulting page revision to advance exactly once, and pins indexing to that returned revision. A changed pre-fetch read stops without network access. Add-website indexing also pins its returned revision. Missing versioned RPC fails closed; no fallback to the unsafe five-argument mutation.

Review migration `20261022075859_es02_page_action_version_guard_review.sql` checks the observed legacy body fingerprint, makes the old signature return VERSION_REQUIRED, and introduces a required six-argument signature. It retains the existing owner/session authority, locks branch then page, checks presence/revision/state, and requires exactly one updated row before invalidating launch confirmation. It is NOT APPLIED or native-compiled. The applied `20261022062222` package is untouched. Actual SQL acceptance still needs an authorized test database: absent/foreign page, stale two-tab retry, invalid state, valid retry/retrain, launch-confirmation race, no-session/non-owner, ACL checks and rollback of unexpected failures.

Proposed Fix / Needs Decision — team and branch knowledge contracts:

- Team: existing `list_company_team` / `mutate_staff_invitation` are company-scoped; they cannot supply a truthful branch snapshot or persist branch skip. Define owner/session-gated branch snapshot + atomic invite/skip RPCs, with server entitlement seat limits, branch membership binding, revision and operation-ID receipts, duplicate/conflict/UNKNOWN handling and persisted skip. Decide explicitly whether to reopen the previously deferred team stage; approving this spec does not enable new admin roles or email delivery.
- Knowledge: existing generic text/upload actions create company sources, while branch reads require private `es02_branch_knowledge_sources` binding. Define owner/session-gated branch mutations/reservation+finalization using existing knowledge validation/storage contracts; create/bind/revision/launch invalidation must commit together, and upload failure must not return success. Use operation-ID recovery, persisted file integrity checks, explicit branch/company ownership and CAS; do not expose private-table direct writes. Define whether a new company source is branch-only or shared before implementation. Acceptance: save/upload then refresh in selected branch, another-branch/company denial, interrupted upload recovery, duplicate request, stale version, unsafe content and quota rejection. No callback wiring to company-only actions until these contracts are approved.

Actual focused check: existing isolated/offline CI wrapper ran `vitest run --config vitest.ci.config.ts src/lib/tenancy/paid-branch-knowledge-flow.test.ts src/lib/tenancy/paid-branch-knowledge-actions.test.ts --maxWorkers=1 --reporter=dot`: 2 files, 20 PASS, 0 FAIL. Synthetic port tests verify parameter forwarding, invalid revision rejection, rejected conflict/no fetch and changed-page/no fetch; they do not execute SQL or prove database concurrency. No browser/provider/Production writes, commit, push or deploy.

Sources: PostgreSQL [row locks](https://www.postgresql.org/docs/17/explicit-locking.html) and [PL/pgSQL result status / ROW_COUNT](https://www.postgresql.org/docs/17/plpgsql-statements.html). Security Notes: RLS, existing authorization, SSRF fetch limits and signed-in identity checks retained; no new dependency or secret read.


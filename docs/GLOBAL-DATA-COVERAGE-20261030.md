# مراجعة تغطية معمارية البيانات — 2026-10-30

**الحكم: مراجعة المصدر اكتملت لـ59/59 ملف صفحة. الهدف المعماري الشامل تحقق جزئيًا؛ لا يوجد دليل يبرر إعلان اكتماله تشغيليًا أو أن هذا أفضل حل مطلق.**

النسخة المرجعية `94da31766050236aeb6b4f53891f0c0fb07a394c`. التغييرات التالية محلية فقط؛ ممنوع Commit/Push/Deploy حتى موافقة صريحة. تصحيح المالك: النشر السابق لم يكن مصرحًا به؛ قراءة الوكيل للعبارة باعتبارها موافقة كانت خطأ. لا تراجع أو نشر إضافي نُفذ في هذه المراجعة.

## نطاق الدليل

- طابقت الجرد مع ملفات `src/app/**/page.tsx` الفعلية: 59، بلا ملفات مفقودة أو زائدة. فحصت مداخل الصفحات وLayouts المشتركة ومالكي قراءات البيانات المرتبطين. جدول كل صفحة أدناه يبين البيانات ومتى تُقرأ والتكرار/الانتظار والقرار. ليس عدّ `await` قياسًا للطلبات أو الأداء.
- تحديث متابعة الفرق: Graphify يطابق HEAD `94da317`، build `c5ab3bd6-f0cb-4a88-ab2b-870e996a2b91`، بتاريخ 2026-10-30 03:36:49 UTC. التعديلات المحلية خارج الفهرس فُحصت بالمصدر مباشرة.
- الصفحات ليست 59 منتجًا مستقلًا: بينها 6 تحويلات، وصفحة تطوير حُذفت محليًا وفق AGENTS (أصبح المتبقي 58)، وواجهتان تعلنان عدم اكتمال الوظيفة. لا توجد صفحات مستقلة مسماة CRM أو notifications أو customer reports في هذا الجرد؛ CRM/lead worklists جزء من dashboard/WhatsApp inbox. لا ننسب تحسينات لميزات غير موجودة.
- هذه مراجعة هندسية محلية. لا قياس محمي قبل/بعد، ولا P50/P95 أو تحقق هاتف شامل. المالك رفض تسجيل دخول محلي سابقًا؛ لم أطلبه مجددًا ولم أستبدله ببيانات إنتاج أو رحلة تجريبية.

## ما هو مشترك فعلًا؟

1. `src/lib/supabase/server.ts`: عميل Broker مدمج داخل render عبر React.cache ومفتاح cookie snapshot بدائي. تغيّر cookies يغير المفتاح، و`fresh:true` يبقى للسلطة الحساسة. ليس كاشًا بين المستخدمين أو عبر الطلبات.
2. `src/lib/tenancy/access.ts`: `loadAuth` و`loadCompanyAccess` مدمجان داخل server render، لذلك layout/page ليسا بالضرورة جولتي DB. Actions/Route Handlers لا تحصل تلقائيًا على نفس ضمان React.cache؛ لم أدّع إلغاء كل تكراراتها. getUser/session ثم profile/platform checks متوازية أصلًا. التحقق من revocation/entitlement بعد القراءة لا يُحذف باسم dedup.
3. `AccountSessionProvider`: يحتفظ بهوية المتصفح ضمن generation، ويجمع إشارات focus/visibility مع refresh جارٍ، ويبطلها عند تغير السلطة. ليس كاشًا عامًا لبيانات الشركات، ولا بديلًا عن native authorization.
4. `createSetupReader`: منسق لكل mount/account/company/branch/boundary فقط، يدمج الوعود الجارية. hours هو الاستثناء الوحيد للاحتفاظ بـpreview عرض لمدة 30ث، مع GET جديد قبل Save. intent prefetch للـhours فقط؛ knowledge/trial/launch لا تُخزّن. الإبطال عند write/scope/pagehide/storage/unmount وعدم قبول late replies محفوظ.
5. `public/sw.js` وCacheBootstrap: كاش assets/fonts فقط، لا HTML أو API أو رسائل/طلبات/بيانات شخصية. Next Link الافتراضي ليس ضمان prefetch لبيانات كل صفحة ديناميكية. لم نضف prefetch ماليًا أو provider calls.
6. Inbox: قراءة أول صفحة ثم تفاصيل عند الاختيار، pagination، تحديث مرئي دوري وbusy guard وscope checks. Branch SSE يحمل invalidation فقط ثم يعيد القراءة المصرح بها. لا دمج لبيانات قنوات/شركات في cache غير معزول.

## التحسينات المحلية المثبتة

| المسار/المالك | قبل | بعد | حدود الدليل |
|---|---|---|---|
| `/` | access ثم public catalog | access/catalog/cookies يبدأون معًا | ليس static HTML؛ الصفحة ما زالت تنتظر النتائج |
| `/app/knowledge` | list ثم write ثم delete | الثلاثة معًا بعد إثبات read | unknown لا يمنح كتابة أو حذف |
| `/admin/companies/[id]` | knowledge ثم branches ثم WA | الثلاثة معًا بعد owner/company existence | كل سياسة فشل كما هي؛ لا إسقاط صلاحية |
| `/admin/audit` | logs ثم total/recent | logs/counts معًا | company search/name hydration تبقى عند اعتمادها |
| `/admin/access` | profiles ثم scopes | الاثنان معًا بعد userIds | لا كاش لدور المنصة |
| `/admin/health` | DB ثم Auth ثم budget | ثلاثة probes مستقلة معًا | مؤقت كل probe مستقل؛ لا قياس مزود AI |
| `/admin/operations` | DB probe ثم snapshot | الاثنان معًا | ingress المشروط لا يبدأ إذا snapshot غير صالح |
| `/admin/channels` | Instagram لكل شركة بالتتابع | دفعات من أربع، بترتيب مستقر وعزل فشل كل شركة | العدد N لم ينخفض؛ سقف concurrency بدل Promise.all غير محدود |
| layouts الحساب والتطبيق | بعض الصفحات تنتظر بلا loading segment | loading مشترك خالٍ من البيانات الخاصة | feedback أسرع، لا تقليل زائف لزمن DB أو تجاوز layout auth |

أضيف dedup صغير في team UI store للقراءات الجارية ذات الطلب والـgeneration نفسيهما فقط؛ بعد انتهاء الوعد تُعاد القراءة التالية، وsuspend/revocation/mutation generation يمنع دمج طلب قديم. لا كاش settled directory ولا تعديل لjournal أو CAS.

لم تُضف مكتبة أو قاعدة تخزين أو ترحيل أو endpoint جديد في هذه المراجعة. لم تتغير mutations أو مسودات العملاء أو أدوات الحذف أو قواعد Lint.

## هل الحل الأقل تعقيدًا؟

للمشكلات المثبتة هنا: التوازي المحدود وReact/Next الموجودان أقل تعقيدًا من إدخال TanStack Query/SWR لكل المنظومة. إضافة shared client cache الآن تستلزم تعريف invalidation لكل حساب/شركة/فرع/دور/نسخة اشتراك، مع خطر تقديم صلاحية أو مالية قديمة. مع معظم الشاشات server-first وقراءات native محمية، لا دليل كافٍ يبرر تلك الكلفة.

هذا **اختيار هندسي مناسب للأدلة الحالية، وليس إثبات الأفضلية المطلقة**. منسق Setup مخصص وصغير لأنه يعالج queue القراءة وscope داخل رحلة واحدة؛ تعميمه على المالية/الأدمن غير مبرر. أفضل خطوة لاحقة هي قياس الشبكة في الرحلات الفعلية، ثم معالجة أعلى تكلفة مثبتة، لا إنشاء Velora Intelligent Data Layer كخدمة مستقلة لمجرد الاسم.

## تغطية كل صفحة

كل صفحة محمية تحتفظ ببوابة الهوية/الدور والشركة/الفرع/RLS في قارئها. «مناسب» تعني لا تغيير آمن مثبت الحاجة في هذه المراجعة، ولا تعني أداء حيًا مثبتًا. البيانات الخاصة fresh افتراضيًا، وPrefetch المخصص يقتصر على ساعات Setup؛ لا يُنسب لكل صف Cache لمجرد وجود layout مشترك.

| # | الصفحة ودليل المدخل | الحكم | البيانات ومصدرها | التحميل/الكاش/Prefetch الحالي | التكرار أو الحجب والقرار |
|---|---|---|---|---|---|
| 1 | [/login](<../src/app/(auth-entry)/login/page.tsx>) | مناسب | نموذج الدخول في auth-entry/layout وauth-pages؛ AccountSessionProvider مشترك | لا قراءة صفحة مستقلة؛ النموذج تفاعلي والهوية بدمج الطلب الجاري | انتظار المصادقة لازم؛ لا Prefetch للـOTP ولا كاش للصلاحيات |
| 2 | [/signup](<../src/app/(auth-entry)/signup/page.tsx>) | مناسب | نموذج التسجيل في نفس layout المستمر | يحافظ على shell عند الانتقال للدخول؛ لا قاعدة بيانات في ملف الصفحة | لا حاجة لطبقة بيانات جديدة؛ تحقق جلسة/تسجيل حي غير مقاس |
| 3 | [/accept-invite](<../src/app/accept-invite/page.tsx>) | مناسب | AcceptInvitePage وأفعال الدعوة | Suspense وقراءة/قبول حسب رمز الدعوة؛ لا كاش نتيجة قبول | تسلسل التحقق والقبول أمني؛ لا prefetch لعملية قبول |
| 4 | [/access](<../src/app/access/page.tsx>) | مناسب | CompanyAccess ثم اختيار بوابة/redirect | loadCompanyAccess مدمج خلال render | الانتظار يحدد الوجهة ولا يصح إزالته بكاش قديم |
| 5 | [/account/businesses/manage](<../src/app/account/businesses/manage/page.tsx>) | غير مكتمل وظيفيًا | CompanyAccess ثم نص توجيهي | لا قائمة شركات إضافية ولا backend لإدارتها في الصفحة | ليست مشكلة Cache؛ لا ننشئ ميزة إدارة ضمن تحسين الأداء |
| 6 | [/account/businesses/new](<../src/app/account/businesses/new/page.tsx>) | مناسب | CompanyAccess ثم مسودة prepayment؛ استعادة checkout مشروطة | مسودة محلية معزولة بالحساب؛ loading الحساب أضيف محليًا | قراءة عملية الدفع ثم order تعتمد عليها؛ لا توازٍ مصطنع أو prefetch للدفع |
| 7 | [/account](<../src/app/account/page.tsx>) | مناسب | AccountProfile والهوية والمنصة | profile initial للعميل؛ provider مشترك؛ loading محلي جديد | قراءة العميل للهوية لا تُلغى باعتبارها تكرارًا؛ تحمي حدود المتصفح والجلسة |
| 8 | [/account/payment/[orderId]](<../src/app/account/payment/[orderId]/page.tsx>) | مناسب | claims ثم session ثم RPC طلب الدفع | قراءة جديدة؛ loading الحساب الجديد | الحالة المالية لا تستخدم SWR؛ عرض الدفع ينتظر إثبات الخادم |
| 9 | [/account/payment/[orderId]/popup](<../src/app/account/payment/[orderId]/popup/page.tsx>) | مناسب | orderId صالح ثم PopupReturn | لا قراءة مالية في الصفحة؛ رسالة رجوع للنافذة الأصلية | لا تغيير مطلوب؛ صحة الدفع ليست مستنتجة من popup |
| 10 | [/account/recovery](<../src/app/account/recovery/page.tsx>) | مناسب | readIdentityRecoveryReviewsAction | قراءة شخصية مصرح بها ثم initialResult؛ loading جديد | إعادة التحقق من boundary/الحساب مقصودة لحساسية الاسترداد |
| 11 | [/account/teams](<../src/app/account/teams/page.tsx>) | محسن محليًا | renderTeamsRoute ثم TeamsPage وteam store | shell بلا directory preflight؛ قراءة واحدة لكل URL وdedup جارٍ مع boundary | القبول الحي غير متاح؛ راجع تقرير القياسات |
| 12 | [/admin/access](<../src/app/admin/access/page.tsx>) | محسن محليًا | platform_admins ثم profiles وplatform_admin_scopes | profiles/scopes متوازيان بعد userIds؛ لا كاش صلاحيات | قائمة المسؤولين كاملة؛ pagination عند نمو الحجم تحتاج عقد واجهة مناسب |
| 13 | [/admin/accounts](<../src/app/admin/accounts/page.tsx>) | مناسب | adminSearchAccounts RPC | 20 عنصرًا؛ Suspense حول القائمة؛ render auth مدمج | بحث/offset من الخادم؛ لا prefetch لكل حساب |
| 14 | [/admin/ai/cycle-costs](<../src/app/admin/ai/cycle-costs/page.tsx>) | غير مكتمل وظيفيًا | locale ثم نص عدم توفر التقرير | لا RPC تكاليف في المسار | ليس بطيئًا بسبب البيانات؛ تقرير ES04 غير منفذ ولا يُختلق |
| 15 | [/admin/ai](<../src/app/admin/ai/page.tsx>) | توازٍ قائم | readAdminAIState وreadSyntheticGeminiFreeState | Promise.all؛ قراءة free فقط إذا enabled؛ loading الأدمن موجود | لا تنفيذ AI/مزود مسبق؛ صلاحية كل reader محفوظة |
| 16 | [/admin/analytics](<../src/app/admin/analytics/page.tsx>) | فرصة متبقية | orders/subscriptions/plans/versions ثم evidence مالي | أربع قراءات متوازية؛ صفحات 250 وحد 10000؛ owner recheck | حسابات وتجميع داخل التطبيق مكلفة عند النمو؛ RPC aggregate يحتاج قياسًا وعقدًا ماليًا/DB، لم يُنشأ ترحيل |
| 17 | [/admin/audit](<../src/app/admin/audit/page.tsx>) | محسن محليًا | logs page وtotal/recent ثم أسماء الشركات | صفحة العد وسجلات العد متوازية؛ الأسماء دفعة in(ids) | بحث الشركات قبل query يعتمد عليه؛ لا SWR لسجل التدقيق |
| 18 | [/admin/billing/orders/[id]](<../src/app/admin/billing/orders/[id]/page.tsx>) | مناسب | readAdminBillingOrder | قراءة native مالية؛ loading الأدمن | order/company/owner binding وإثبات مالي جديد؛ تسلسل آمن |
| 19 | [/admin/billing](<../src/app/admin/billing/page.tsx>) | مناسب | readAdminBillingOrders | قائمة مفلترة بمؤشر cursor؛ loading الأدمن | لا تحميل كل دفتر الدفع مسبقًا؛ لا كاش يمنح سلطة مالية |
| 20 | [/admin/catalog](<../src/app/admin/catalog/page.tsx>) | مناسب | readCatalogAdminAction | initial data للخادم؛ تعديلات بعقود version/CAS | لا كاش مشترك للكتالوج الإداري؛ invalidate بعد التحرير |
| 21 | [/admin/channels](<../src/app/admin/channels/page.tsx>) | محسن محليًا | companies ثم WA links ثم Instagram لكل شركة | Instagram دفعات متوازية حدها 4؛ Suspense موجود | عدد RPC ما زال N؛ لم ندّع إزالة N+1. Bulk RPC وpagination فرصة توسع لاحقة تحتاج عقدًا جديدًا |
| 22 | [/admin/companies/[id]/conversations](<../src/app/admin/companies/[id]/conversations/page.tsx>) | مناسب | بوابة منصة ثم adminListCompanyConversations | قائمة 20 وphone scope؛ إعادة fallback فقط لفلتر قديم | التسلسل يعتمد على اختيار الهاتف؛ لا تحميل جميع الرسائل مسبقًا |
| 23 | [/admin/companies/[id]](<../src/app/admin/companies/[id]/page.tsx>) | محسن محليًا | admin_get_company ثم knowledge/branches/WA | ثلاثة enrichments متوازية بعد صلاحية ووجود الشركة؛ أخطاء منفصلة | لا كاش معلومات عميل إداري؛ company read أولًا مقصود |
| 24 | [/admin/companies](<../src/app/admin/companies/page.tsx>) | تحويل | searchParams ثم redirect إلى /admin | لا قراءة بيانات خاصة في هذه الصفحة | لا تحسين بيانات مطلوب؛ الوجهة هي التي تُراجع |
| 25 | [/admin/health](<../src/app/admin/health/page.tsx>) | محسن محليًا | DB probe وAuth probe وAI budget metadata | ثلاثة فحوص متوازية، مؤقت مستقل لكل فحص | لا تخزين نتائج health كحقيقة حالية؛ metadata لا تثبت عمل AI |
| 26 | [/admin/identity-recovery](<../src/app/admin/identity-recovery/page.tsx>) | مناسب | readIdentityRecoveryReviewsAction بوضع admin | بوابة منصة ثم RPC؛ initialResult | قراءات fresh وحدود الهوية مقصودة؛ لا كاش استرداد |
| 27 | [/admin/operations](<../src/app/admin/operations/page.tsx>) | محسن محليًا | DB probe وoperations snapshot؛ ingress حسب flag | الـprobe والـsnapshot متوازيان؛ ingress مشروط بعد صحة snapshot | latency خاص بالـprobe؛ لا ادعاء قياس tracing/provider، والقراءة المشروطة محفوظة |
| 28 | [/admin](<../src/app/admin/page.tsx>) | توازٍ قائم | admin_overview_stats وreadAdminTruth؛ قائمة شركات client | overview/truth متوازيان؛ القائمة عند التفاعل/الفلاتر؛ loading الأدمن | لا prefetch لكل الشركات أو العملاء؛ إمكانية تجميع إضافي تحتاج قياس الطلبات الحية |
| 29 | [/admin/qa](<../src/app/admin/qa/page.tsx>) | مناسب | owner ثم es02_admin_list_qa_setup | قائمة إدارية مصرح بها؛ ليست رحلة عميل موازية | لم تُشغّل أفعال reset؛ لا تحسين بيانات مثبت لهذه القراءة المفردة |
| 30 | [/admin/settings](<../src/app/admin/settings/page.tsx>) | مناسب | requirePlatformRole ثم policy/automations constants | لا استعلام إعدادات إضافي بعد البوابة؛ قيم تشغيل معروضة من المصدر | Cache إضافي لن يوفر DB هنا؛ لا ندّعي أن constants إعدادات محفوظة |
| 31 | [/admin/support](<../src/app/admin/support/page.tsx>) | محسن سابقًا | tickets و3 counts ثم company names | page/counts متوازية؛ page limit ودفعة أسماء | لم يتغير محليًا؛ authority وفلترة البحث قبل القراءة محفوظة |
| 32 | [/admin/teams](<../src/app/admin/teams/page.tsx>) | محسن محليًا | teams-route مع owner ثم client store | حذف preflight المهمل والقراءة المبكرة أثناء التنقل مع إبقاء بوابة owner | القبول الحي غير متاح؛ راجع تقرير القياسات |
| 33 | [/app/conversations](<../src/app/app/conversations/page.tsx>) | توازٍ قائم | readServiceInbox ثم WA/IG native readers | permissions/contract متوازية، ثم القناتان؛ Suspense، قائمة WA 40، thread عند الاختيار، refresh مرئي 30ث مع busy guard | لا كاش عام للرسائل؛ إعادة capability/scope بعد read مقصودة؛ يحتاج قياس polling وتأثيره مع Realtime |
| 34 | [/app/instagram](<../src/app/app/instagram/page.tsx>) | مناسب | CompanyAccess/query ثم InstagramConnectionPage | access وparams متوازيان؛ redirect للـthread داخل Inbox؛ loading التطبيق الجديد | read connection يبقى native/current؛ لا prefetch OAuth/ربط |
| 35 | [/app/knowledge](<../src/app/app/knowledge/page.tsx>) | محسن محليًا | knowledge.read ثم listSources وwrite/delete capabilities | الثلاثة متوازيون بعد read grant؛ Suspense موجود | unknown capability=false؛ list/RPC والكتابة يعيدان التحقق؛ لا كاش قديم للمعرفة |
| 36 | [/app/organization](<../src/app/app/organization/page.tsx>) | مناسب | CompanyAccess ثم enterprise_workspace | RPC workspace واحد بعد feature/identity/company gate؛ loading جديد | لا حاجة لتفكيك RPC أو طبقة جديدة؛ إدارة الفروع المؤجلة لا تصبح منفذة بتحسين الأداء |
| 37 | [/app](<../src/app/app/page.tsx>) | محسن سابقًا | CustomerReadiness وWA initial inbox | قراءة الاثنتين بالتوازي؛ readiness داخليًا allSettled؛ Suspense صحيح | ملخص CRM من الوارد، لا صفحة CRM منفصلة؛ full latency غير مقاس |
| 38 | [/app/settings](<../src/app/app/settings/page.tsx>) | محسن سابقًا | access/WA link ثم subscription/offers/activation/credits | مجموعتان متوازيتان وSuspense؛ Team panel عند تبويبه | بعض القراءات تحمّل حتى عند تبويب آخر؛ فصلها يتطلب قياسًا وUX قبول، لا كاش لسلطة الاشتراك |
| 39 | [/app/subscription/orders/[orderId]](<../src/app/app/subscription/orders/[orderId]/page.tsx>) | مناسب | owner ثم billing return ثم catalog إذا selection موجود | financial read جديد؛ loading التطبيق الجديد | قراءة catalog مشروطة بنتيجة الطلب؛ لا إسقاطها/تخزين حالة دفع لتجميل السرعة |
| 40 | [/app/subscription](<../src/app/app/subscription/page.tsx>) | محسن سابقًا | SettingsRoute subscriptionOnly | نفس التوازي وstreaming؛ ليس data layer منفصلًا | WA link قد لا يلزم tab الاشتراك؛ تحسينه مشروط باستهلاك SettingsPage المشترك وقياس، لم يجر إسقاط بيانات محتملة |
| 41 | [/app/test](<../src/app/app/test/page.tsx>) | مناسب | owner ثم AssistantTester | لا طلب AI حتى تفاعل المستخدم؛ loading التطبيق الجديد | ليس سيناريو Prefetch؛ لا تخمين إجابات أو تشغيل مزود تلقائيًا |
| 42 | [/branch](<../src/app/branch/page.tsx>) | فرصة متبقية | identity ثم listMyBranchAccess ثم readBranchInbox | قائمة/رسائل 50؛ SSE invalidation ثم authorized reread | تكرار identity عبر native readers؛ مقصود مبدئيًا للفصل/revocation، لا memoization جديد؛ محتوى الصفحة حاجب بعد الهوية |
| 43 | [/complete-profile](<../src/app/complete-profile/page.tsx>) | مناسب | CompanyAccess ثم redirect أو النموذج | request-scoped dedup موجود | الانتظار يحدد نقص الملف؛ mutation/profile freshness محفوظة |
| 44 | [/data-deletion](<../src/app/data-deletion/page.tsx>) | مناسب | LegalPage ثابت | لا قراءة بيانات عملاء؛ assets/fonts SW عام | لا Cache بيانات مطلوب؛ ليست أداة تنفيذ حذف الحسابات |
| 45 | [/forgot-password](<../src/app/forgot-password/page.tsx>) | مناسب | Auth form | Suspense + عملية عند الطلب | لا prefetch إرسال بريد ولا cache إثبات نجاح |
| 46 | [/](<../src/app/page.tsx>) | محسن محليًا | locale وCompanyAccess وpublic catalog | الثلاثة يبدأون بالتوازي؛ assets/fonts static cache قائم | الـhero ما زال ينتظر promises؛ streaming مستقل للباقة/identity فرصة لاحقة، يتطلب فصل LandingPage لا كاش auth |
| 47 | [/preview/dashboards/admin](<../src/app/preview/dashboards/admin/page.tsx>) | تحويل | redirect /admin | لا بيانات معاينة | لا مسار بيانات مستقل |
| 48 | [/preview/dashboards/client](<../src/app/preview/dashboards/client/page.tsx>) | تحويل | redirect /app/settings?tab=plan | لا بيانات معاينة | لا مسار بيانات مستقل |
| 49 | [/preview/dashboards](<../src/app/preview/dashboards/page.tsx>) | تحويل | redirect /app/settings?tab=plan | لا بيانات معاينة | لا مسار بيانات مستقل |
| 50 | `/preview/subscription` (ملف محذوف محليًا) | محذوف محليًا | راجعنا معاينة التطوير القديمة ثم حذفنا المدخل ومكوّنه الوحيد وفق AGENTS | لا بديل تجريبي؛ /app/subscription هو المسار الفعلي | 59 مدخلًا تمت مراجعته، 58 صفحة تبقى بعد حذف المعاينة؛ لا تحسين latency مزعوم من الحذف |
| 51 | [/privacy](<../src/app/privacy/page.tsx>) | مناسب | LegalPage ثابت | لا قراءة قاعدة بيانات خاصة | لا مكتبة Cache لازمة |
| 52 | [/reset-password](<../src/app/reset-password/page.tsx>) | مناسب | ResetPasswordPage | Suspense؛ mutation محمية عند التفاعل | لا تخزين أو prefetch نتيجة reset |
| 53 | [/setup/branches/[branchId]/whatsapp](<../src/app/setup/branches/[branchId]/whatsapp/page.tsx>) | مناسب | owner ثم connection-before/setup/connection-after | قراءات تحقق جيل وربط قبل وبعد؛ setup layout loading | ليس تكرارًا يُزال بالـcache؛ الترتيب يحمي callback/race؛ أبقيناه |
| 54 | [/setup/branches](<../src/app/setup/branches/page.tsx>) | تحويل | redirect /setup | لا بيانات إضافية | لا رحلة تجهيز موازية |
| 55 | [/setup](<../src/app/setup/page.tsx>) | محسن سابقًا | CompanyAccess ثم paid shell وworkspace وخطوات مستقلة | GET no-store، in-flight dedup لكل scope، hours intent prefetch وpreview 30ث، fresh Save، draft fence | full workspace يحافظ قبل/بعد؛ لا كاش launch/payment/verified؛ قياس رحلة محمية حيًا غير منفذ |
| 56 | [/setup/qa](<../src/app/setup/qa/page.tsx>) | تحويل | redirect /setup | لا بيانات إضافية | ليس إثبات QA حيًا |
| 57 | [/terms](<../src/app/terms/page.tsx>) | مناسب | LegalPage؛ draft component بتفعيل محدد | بيانات ثابتة واستيراد شرطي | لا قاعدة بيانات تحتاج Cache؛ المحتوى القانوني خارج مراجعة الأداء |
| 58 | [/verify-email](<../src/app/verify-email/page.tsx>) | مناسب | VerifyEmailPage وAccountSessionProvider | Suspense ودمج refresh الجاري عند focus/visibility | لا prefetch OTP/resend؛ user/epoch guards مهمة |
| 59 | [/verify-phone](<../src/app/verify-phone/page.tsx>) | توازٍ قائم | getPersonalPhoneStatus وsearchParams | Promise.all؛ الهوية ثم native status؛ initialResult | توازي params لا يزيل RTT المصادقة؛ الإرسال/التحقق ليسا بيانات قابلة للـprefetch |

## ما اكتمل وما لم يكتمل

اكتمل محليًا: مطابقة 59 مدخل صفحة وتقييم مالكي البيانات المشتركين؛ التوازي السابق في Setup/settings/dashboard/support؛ الثمانية تحسينات الإضافية أعلاه؛ عرض تحميل للمسارات المحمية الإضافية؛ مراجعة عدم إدخال كاش صلاحيات أو رسائل أو ماليات، والحفاظ على المسودات وعمليات CAS وإعادة التحقق. لا ادعاء أن التغيير السابق شمل الـ59 صفحة كلها.

لم يكتمل تشغيليًا: إثبات زمن الانتقال الحقيقي لكل رحلة، نسبة انخفاض الطلبات الإجمالية، قياسات الأجهزة/المناطق، أو قبول جميع رحلات المنتج. بوابات الاختبارات المحلية لا تعوض ذلك.

فرص باقية محددة وليست وعدًا بأنها ضرورية الآن:
- Teams: أُغلق محليًا تكرار preflight والتنقل، بالإضافة إلى dedup الجاري. أضيف boundary fence؛ لم نضف hydration cache. [الدليل والقيود](TEAMS-READS-PROTECTED-MEASUREMENTS-20261030.md).
- Channels: ما زال RPC لكل شركة؛ حل جذري عند الحجم هو bulk/paginated native read بعقد يحافظ على الأمان، لا فتح مئات الطلبات بالتوازي. لم تُنفذ SQL/مهاجرة.
- Analytics: تجميع أدلة مالية يصل إلى 10000 صف/مصدر؛ المصدر يفشل بدل إسقاط البيانات. تجميع DB محتمل بعد إثبات التكلفة ودقة النتائج.
- Homepage: تخفيض التتابع لا يفصل hero عن catalog/identity. فصل Suspense أدق ممكن، لكنه يغير عقد LandingPage/CTA ويحتاج قياس UX؛ لم نُعد بناء صفحة تعمل لمجرد تعميم نمط.
- Settings/subscription: احتمالية overfetch من renderer المشترك؛ لا إسقاط لقيم يستهلكها SettingsPage/تبويباته دون فحص قبول تبويب محدد.
- Branch/inbox: native rechecks وpolling ليست أخطاء تلقائيًا؛ يلزم قياس قبل دمجها أو استبدالها بـRealtime عام.
- حُذفت محليًا صفحة `/preview/subscription` ومكوّنها الوحيد امتثالًا لـAGENTS بعد التحقق من عدم وجود مستهلك آخر؛ بقي `/app/subscription` الحقيقي. التحويلات القديمة ليست صفحات معاينة مستقلة.

## مراجع القرار

- [Next.js — data fetching, parallel reads and streaming](https://nextjs.org/docs/app/getting-started/fetching-data)، مع مراجعة دليل النسخة المثبتة في `node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md`.
- [React.cache](https://react.dev/reference/react/cache): memoization داخل Server Components/طلب العرض، وليس كاشًا عالميًا دائمًا.
- [Supabase SSR advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide): حماية الاستجابات المرتبطة بالجلسة من الكاش المشترك.


## الفحوص النهائية وحدودها

- 54/54 اختبارًا متأثرًا في 8 ملفات: الصفحات/قراءات الأدمن، توازي الرئيسية والمعرفة، وconcurrency مركز القنوات (حد 4، ترتيب ثابت، فشل شركة لا يلغي الأخرى، منع القراءة قبل owner).
- 55/55 اختبارًا في 5 ملفات للفرق: store/route contracts/UI/actions، منها dedup طلب جارٍ، fresh read بعد settlement، وعدم دمج طلب بعد suspend وتجاهل رد قديم. المجموع 109 حالات مختلفة، وليس جمعًا لتكرارات التشغيل.
- `ci:typecheck` PASS؛ `ci:build` النهائي PASS بعد dedup الفرق وحذف المعاينة، ويشمل فحص TypeScript وتوليد المسارات. لا نشر من أمر build المحلي.
- ESLint للملفات المعدلة/الجديدة PASS بـ`--max-warnings=0`؛ لا تغيير قواعد أو ignores. لم نعد تشغيل Lint لكامل workspace الذي يحتوي أدوات حذف حسابات غير متتبعة مع أخطاء معروفة؛ لذلك لا ندّعي PASS له. `scripts/ci/security.mjs` PASS (baseline المتتبع 2106 paths؛ الرقم ليس عدد ملفات جديدة).
- `git diff --check` PASS. 155 ملفًا سابقًا/خارج المهمة تطابق بصماتها قبل وبعد. لم نعد suite الوحدة الشامل أو العقود الشاملة السابقة بلا حاجة.
- لا CI مستضاف لهذه التغييرات المحلية ولا قبول متصفح محمي أو اختبارات RLS حية. HEAD بقي `94da317` وGit index خاليًا. لا Commit/Push/Deploy في هذه المراجعة.
- سجلات محلية: `.git/architecture-final-tests.log`, `.git/architecture-teams-tests.log`, `.git/architecture-final-types.log`, `.git/architecture-lint.log`, `.git/architecture-final-lint.log`, `.git/architecture-security.log`, `.git/architecture-final-build.log`.

## الملفات المحلية ضمن نطاق هذه المراجعة

- [PROJECT_STATE.md](<../PROJECT_STATE.md>)
- [docs/GLOBAL-DATA-COVERAGE-20261030.md](<../docs/GLOBAL-DATA-COVERAGE-20261030.md>)
- [docs/GLOBAL-DATA-PERFORMANCE-20261030.md](<../docs/GLOBAL-DATA-PERFORMANCE-20261030.md>)
- [docs/global-data-coverage-20261030.json](<../docs/global-data-coverage-20261030.json>)
- [src/app/account/loading.tsx](<../src/app/account/loading.tsx>)
- [src/app/admin/companies/[id]/page.test.tsx](<../src/app/admin/companies/[id]/page.test.tsx>)
- [src/app/admin/companies/[id]/page.tsx](<../src/app/admin/companies/[id]/page.tsx>)
- [src/app/app/knowledge/page.tsx](<../src/app/app/knowledge/page.tsx>)
- [src/app/app/loading.tsx](<../src/app/app/loading.tsx>)
- [src/app/data-loading.test.tsx](<../src/app/data-loading.test.tsx>)
- [src/app/page.tsx](<../src/app/page.tsx>)
- `src/app/preview/subscription/page.tsx` — حذف المعاينة غير المستخدمة
- [src/components/app/route-loading.tsx](<../src/components/app/route-loading.tsx>)
- [src/lib/platform-teams/ui-state.test.ts](<../src/lib/platform-teams/ui-state.test.ts>)
- [src/lib/platform-teams/ui-state.ts](<../src/lib/platform-teams/ui-state.ts>)
- [src/lib/tenancy/access-actions.ts](<../src/lib/tenancy/access-actions.ts>)
- [src/lib/tenancy/audit-actions.ts](<../src/lib/tenancy/audit-actions.ts>)
- [src/lib/tenancy/channels-actions.ts](<../src/lib/tenancy/channels-actions.ts>)
- [src/lib/tenancy/channels-parallel.test.ts](<../src/lib/tenancy/channels-parallel.test.ts>)
- [src/lib/tenancy/health-actions.ts](<../src/lib/tenancy/health-actions.ts>)
- [src/lib/tenancy/operations-actions.ts](<../src/lib/tenancy/operations-actions.ts>)
- `src/preview/subscription/subscription-preview.tsx` — حذف المعاينة غير المستخدمة

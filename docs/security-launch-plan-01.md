# VEL-SECURITY-LAUNCH-PLAN-01 — خطة مراجعة أمان ما قبل الإطلاق

| الحقل | القيمة |
| --- | --- |
| الحالة | **تخطيط + فحص قراءة فقط** — ليست اختبار اختراق ولا تعديل تشغيل |
| الإصدار | FIX-01 (2026-10-06) |
| المرحلة | **الأخيرة قبل إطلاق العملاء والدفع الحقيقي** — بعد اكتمال الوظائف |
| يعتمد على | `docs/access-management-01-design.md` · `docs/roadmap.md` · artifacts/`VEL-*` · أدلة بيئة بتاريخ |

**إخلاء مسؤولية:** هذه الخطة لا تضمن حماية كاملة ولا تعلن حماية 100%. قبول مخاطر متبقية قرار صريح (مسؤول + مدة + تعويضات) ولا يحوّل FAIL إلى PASS.

---

## 0. حالة البيئة — بدليل وتاريخ (لا استنتاج من تقرير أقدم)

| بند | الحالة الموثّقة | دليل | تاريخ |
| --- | --- | --- | --- |
| هجرات واتساب الأساسية (سلسلة inbound/control/outbound/registry حسب قراءة المخطط) | **مطبّقة على الإنتاج** | قراءة مخطط قاعدة الإنتاج / `schema_migrations` (جلسة ops) | **2026-10-06** |
| ACCESS الجديد (VEL-ACCESS-MANAGEMENT-01 / FIX2) | **غير مطبّق على الإنتاج** | تصميم + artifacts محلية؛ لا دليل apply سحابي | 2026-10-06 |
| فوترة Paymob (migrations 180000→230000 + wiring) | **محلية / اختبار محلي فقط** — غير مفروضة كمسار إنتاج حي | artifacts `VEL-BILLING-*` / `VEL-PAYMOB-*`؛ لا apply cloud موثّق | 2026-10-06 |
| إعدادات الإرسال Meta (`WHATSAPP_ALLOW_EXTERNAL_SEND` وغيرها) | **تحتاج تحققًا في بيئة التشغيل** | قيم env التشغيلية ليست مثبتة في هذه الخطة | — |
| AI live answering | `liveAi: false` في `src/lib/ops/launch-scope.ts` (كود) | قراءة كود — **ليست** إثبات حالة env الإنتاج | 2026-10-06 |

**قواعد كتابة الحالة**

- لا تُعكس نتيجة هجرات واتساب المثبتة 2026-10-06 بتقرير أقدم (مثل فقرات في `handoff-report` / `roadmap` كتبت قبل أو بغير قراءة مخطط).
- لا تُكتب «Meta مطفأ» أو «الإرسال الحي مغلق» كحقيقة مؤكدة قبل تحقق env/تشغيل.
- غياب هجرة (مثل ACCESS أو billing على cloud) **لا يثبت وحده** أن المسار fail-closed؛ يلزم اختبار سلوك فعلي أو إثبات ضابط آخر.

---

## 1. نطاق ومصادر (بدون خطة موازية)

### 1.1 ما يُعاد استخدامه

| المصدر | الاستخدام |
| --- | --- |
| `docs/access-management-01-design.md` (FIX2) | نموذج صلاحيات؛ يُنفَّذ بعد apply على staging/prod |
| `artifacts/VEL-ACCESS-MANAGEMENT-01/sql_tests_fix2.sql` | اختبارات SQL محلية للمنح |
| `scripts/vel005a-rls-check.mjs` · `vel006a-knowledge-isolation-check.mjs` · `vel005c-admin-isolation.mjs` · `vel005d-r2-owner-guard-check.mjs` · `vel-a10-01-suspended-company-isolation.mjs` | عزل/حراسة — إعادة تشغيل على staging |
| `artifacts/VEL-BILLING-*` · `VEL-PAYMOB-*` | تسوية، HMAC، مراجعات؛ فصل PASS محلي عن staging |
| `src/lib/billing/wiring/fix-01.test.ts` · `journey.test.ts` | PASS محلي (mock) بعد FIX-01 الكود |

### 1.2 نقاط الدخول (قراءة كود)

| النوع | المسارات / الوحدات |
| --- | --- |
| HTTP API | `POST /api/whatsapp/webhook` · `POST /api/billing/paymob/webhook` · `GET /api/billing/paymob/return` |
| Proxy جلسة | `src/proxy.ts` — `/app`, `/setup`, `/admin`, `/account`, `/complete-profile` |
| Server Actions | `tenancy` · `knowledge` · `whatsapp` · `access` · `billing/wiring/order-actions` |
| RPC | واتساب · ACCESS (بعد apply) · billing settlement (`service_role`) |
| خلفية | AI channel adapter · inbound worker · `runBillingEventProcessing` — حالة الجدولة/التوصيل تُتحقق ولا تُفترض من الكود وحده |

### 1.3 أصول حساسة

هوية (Auth/JWT/cookies) · عزل بيانات (RLS + حراسة خادمية) · Storage معرفة · أسرار env/Vault · جداول مالية · رسائل WA · سياق AI.

---

## 2. فصل طبقات الضوابط (لا خلط)

| الطبقة | ماذا تغطي | مثال في Velora |
| --- | --- | --- |
| **صلاحيات الجداول (GRANT/REVOKE)** | من يستطيع `SELECT/INSERT/...` على الجدول من دور DB | billing: `REVOKE` من `anon`/`authenticated` |
| **RLS** | صفوف مرئية لـ JWT ضمن سياسات Postgres | companies / knowledge / whatsapp policies |
| **حراسة RPC/API/Server Action** | من يستدعي الدالة/المسار وبأي أدلة | `getCompanyAccess('owner')` · EXECUTE على settlement لـ `service_role` فقط |

كل طبقة تُختبر وحدها. نجاح REVOKE لا يغني عن RLS؛ نجاح RLS لا يغني عن حراسة الـ action.

| ضابط | منفصل عن | ملاحظة |
| --- | --- | --- |
| **CSRF / أصل الطلب** (Server Actions، cookies) | **Rate limiting / مكافحة أتمتة** | اختباران مختلفان (WEB-CSRF-* مقابل ABUSE-*) |
| «لم يظهر ضابط في المسارات المقروءة» | «غير موجود في المنصة» | قد يوجد WAF/edge/Supabase Auth rate limits خارج المستودع — يُسجَّل **NOT_OBSERVED_IN_REPO** ثم يُتحقق تشغيلًا |

---

## 3. نموذج تهديد مختصر

| الفاعل | أصل | ضابط مذكور في الكود/artifacts | فجوة / حالة اختبار |
| --- | --- | --- | --- |
| زائر | `/app`, `/admin` | `proxy.ts` + session | CSRF وsession: staging NOT_RUN |
| مالك | بيانات شركة أخرى | RLS + `getCompanyAccess` | ISO على staging إلزامي |
| موظف محدود | inbox/إرسال | grants + RLS — **ACCESS الجديد غير على prod** | بعد apply؛ لا تعتمد على UI |
| أدمن مفوّض | خارج النطاق | `can_admin_company` | `vel005c` على staging |
| مهاجم webhook/replay | أحداث/اشتراك | HMAC؛ uniqueness | Paymob: كود FIX-01 ≠ retest staging |
| محتوى خبيث | معرفة/رسائل/AI | حدود حجم/mime؛ عزل مفتاح | معيار injection §6 — ليس حد الحروف وحده |
| تسريب `service_role` | كل البيانات | admin client خادمي في الكود | تدوير + ACL env |
| ops | نسخ/استعادة | سياسة backup المنصة | قابلية الاستعادة **غير متحققة** حتى drill |

---

## 4. حالة نتائج الاختبار — مصطلحات إلزامية

| الرمز | المعنى |
| --- | --- |
| **PASS_LOCAL** | نجح على mock/وحدة/DB محلي مصرّح — لا يكفي وحده للإطلاق |
| **PASS_STAGING** | نجح على بيئة staging (أو prod-like) بأدلة محفوظة |
| **CODE_FIXED** | تعديل كود مغلق (مثل WIRING-FIX-01) — **ليس** PASS اختبار |
| **RETEST_REQUIRED** | بعد CODE_FIXED يلزم إعادة تشغيل سيناريو القبول |
| **NOT_RUN** | لم يُنفَّذ بعد |
| **NOT_OBSERVED_IN_REPO** | لم يظهر في المسارات المقروءة؛ قد يوجد خارج المستودع |
| **UNVERIFIED** | لم يُثبت سلبًا ولا إيجابًا (مثل restore قبل drill) |
| **FAIL** | فشل بمعيار القبول؛ يبقى FAIL حتى إصلاح + إعادة اختبار ناجحة |

**Paymob WIRING:** REVIEW FAIL-1..3 → **CODE_FIXED** في FIX-01 → حالة الاختبار الرسمية: **RETEST_REQUIRED** (محليًا `fix-01` / journey = PASS_LOCAL؛ staging = NOT_RUN).

---

## 5. Auth، جلسات، صلاحيات، عزل

### 5.1 ضوابط مذكورة في الكود (قراءة)

- `identityVerified` قبل membership
- billing create: `getCompanyAccess('owner')`
- أدمن منصة: اختيار شركة صريح
- تعليق أمني يتفوق على الفترة المدفوعة (اختبارات billing محلية)

### 5.2 اختبارات (ASVS 5.0.0)

مرجع المتطلبات: [OWASP ASVS 5.0.0](https://github.com/OWASP/ASVS) — صيغة `v5.0.0-<chapter>.<section>.<req>`.

| ID | سيناريو | تنفيذ آمن | بيئة | معيار نجاح | معيار فشل | ASVS | Sev | حالة |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTH-01 | جلسة منتهية → `/app` | متصفح + JWT منتهٍ | staging | redirect login | وصول محتوى محمي | v5.0.0-7.3.* / 7.4.* | Med | NOT_RUN |
| AUTH-02 | هوية غير مؤكدة | حساب synthetic | staging | رفض UNVERIFIED | وصول | v5.0.0-6.3.* | Med | NOT_RUN |
| AUTH-03 | staff يستدعي action مالك | استدعاء action | staging | FORBIDDEN | نجاح العملية | v5.0.0-8.3.* | High | NOT_RUN |
| ISO-01 | owner A يقرأ company B | `vel005a-rls-check` | staging | deny/empty | صفوف أجنبية | v5.0.0-8.2.* / 8.3.* | Critical | NOT_RUN |
| ISO-02 | ملف معرفة B من A | `vel006a-knowledge-isolation-check` | staging | deny | bytes أجنبية | v5.0.0-8.3.* / 5.* | Critical | NOT_RUN |
| ISO-03 | أدمن خارج النطاق | `vel005c-admin-isolation` | staging | deny | بيانات | v5.0.0-8.3.* | High | NOT_RUN |
| ISO-04 | `order_id` شركة أخرى | GET return | staging | لا كشف / لا مدة أجنبية | تسريب | v5.0.0-8.3.* | High | NOT_RUN |
| ISO-05 | cookie workspace مفبرك | cookie B | staging | لا عضوية مزيفة | cross-tenant | v5.0.0-8.2.* | High | NOT_RUN |
| PRIV-01 | سحب منحة فوري | revoke ثم طلب | staging | deny فوري | استمرار صلاحية | v5.0.0-8.4.* | Med | NOT_RUN |

**مراجع:** [ASVS repo](https://github.com/OWASP/ASVS) · [ASVS 5.0.0 PDF](https://github.com/OWASP/ASVS/blob/master/5.0/OWASP_Application_Security_Verification_Standard_5.0.0_en.pdf) · [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) — مراجعة روابط 2026-10-06

---

## 6. دفع Paymob وإشعارات

### 6.1 ضوابط في الكود/artifacts (محلي)

أعلام create/webhook/settle/live · HMAC · مطابقة order/owner/integration/amount · return من DB · REVOKE + RLS billing · RPC HMAC settlement لـ service_role · OMR NOT_CONFIGURED يمنع Intention في الحزمة الحالية.

### 6.2 فصل: أثر مالي vs عقد HTTP

- **ثغرة الدفع** = منح استحقاق أو أثر مالي/اشتراك غير صحيح، أو قبول إشعار غير موثوق يؤدي إلى ذلك.
- **اختلاف HTTP status وحده** (مثل 401 vs 403) **ليس** ثغرة ما لم يثبت تجاوز أثر أو كشف بيانات.
- **العقد الدلالي** (نص الجسم: `stored` / `stored_awaiting_processing` / `duplicate`) يُختبر في صف منفصل ولا يُخلط مع معيار الاستحقاق.

### 6.3 اختبارات

| ID | سيناريو | نجاح (أثر) | فشل (أثر) | HTTP/عقد (منفصل) | Sev | حالة |
| --- | --- | --- | --- | --- | --- | --- |
| PAY-01 | HMAC خاطئ | لا event موثوق · لا grant | event/grant بدون تحقق | يُسجَّل status للملاحظة فقط | Critical | NOT_RUN staging؛ PASS_LOCAL جزئي |
| PAY-02 | replay نفس observation | لا grant ثانٍ | اشتراك/grant مكرر | `duplicate` عقد دلالي | Critical | كذلك |
| PAY-03 | capture flip (موقّع) | صفان متميزان إن لزم | ضياع ملاحظة مالية | غير معيار الاستحقاق | High | CODE_FIXED + PASS_LOCAL → RETEST staging |
| PAY-04 | return `?success=true` بلا grant | لا `payment_confirmed` / لا entitlement | نجاح اشتراك من الرابط | — | Critical | PASS_LOCAL mapper → NOT_RUN staging |
| PAY-05 | amount/currency mismatch | لا settle | settle بمبلغ خاطئ | — | Critical | NOT_RUN staging |
| PAY-06 | live enabled | لا اتصال/لا settle حي | طلب حي أو settle live | — | Critical | NOT_RUN |
| PAY-07 | تسوية متزامنة | grant×1 | grant×2 | — | Critical | PASS_LOCAL artifacts → NOT_RUN staging إن لزم |
| PAY-08 | webhook قبل المعالجة | return awaiting؛ لا اشتراك من 200 وحده | اشتراك لمجرد 200 | عقد `stored_awaiting_processing` منفصل | High | CODE_FIXED + PASS_LOCAL → RETEST |
| PAY-SEM | عقد الجسم vs الحالة | توثيق تطابق الوثائق | تضليل تشغيلي فقط | لا يرفع Critical ما لم يسبب أثرًا | Low/Med | منفصل |

---

## 7. WA، CSRF، XSS، injection، SSRF، ملفات، إساءة

| ID | مجال | ضابط مذكور في المسارات المقروءة | اختبار | حالة |
| --- | --- | --- | --- | --- |
| WA-01 | توقيع webhook | `x-hub-signature-256` في الكود | POST بلا توقيع → لا persist موثوق | NOT_RUN staging |
| WA-02 | توجيه مستأجر | resolver في الكود | رقم غير مربوط | NOT_RUN؛ تحقق وضع التوجيه من env |
| WA-03 | تكرار رسالة | uniqueness مذكور في تصميم/SQL | replay | NOT_RUN |
| WEB-CSRF-01 | CSRF / origin على Server Actions | Next.js Server Actions (منصة) | طلب cross-site يغيّر حالة | NOT_RUN؛ منفصل عن rate limit |
| WEB-XSS-01 | XSS inbox | React افتراضيًا | payload في رسالة | NOT_RUN |
| INJ-01 | SQL/RPC | عميل مُعامل + RLS | fuzz RPC | NOT_RUN |
| SSRF-01 | Paymob URL | allowlist في الكود | قاعدة غير مسموحة | PASS_LOCAL وحدة |
| FILE-01/02 | رفع/استخراج | حدود حجم/mime/نص في الكود | ملف خبيث/ضخم | NOT_RUN |
| SEC-LOG | أسرار في السجلات | diag مختصر في مسارات webhook المقروءة | مراجعة عيّنة | NOT_RUN |
| ABUSE-01 | مكافحة إساءة / rate limit | **NOT_OBSERVED_IN_REPO** على مسارات التطبيق المقروءة | إثبات ضابط فعلي (edge/WAF/Auth/مخصص) تحت حمل آمن | NOT_RUN — **إلزامي قبل الإطلاق** |

**مراجع:** [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations) · [Meta Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started) · ASVS v5.0.0-2.4.* (anti-automation) · v5.0.0-3.5.* (origin) · v5.0.0-1.2.* (injection) — 2026-10-06

---

## 8. AI وواتساب (عند التفعيل)

| ID | سيناريو | معيار النجاح | معيار الفشل |
| --- | --- | --- | --- |
| AI-01 | تعليمات داخل رسالة/ملف (prompt injection) | **لا تسريب** معرفة/بيانات شركة أخرى؛ **لا تنفيذ** إرسال أو إجراء غير مأذون | تسريب أو فعل غير مأذون |
| AI-02 | عزل سياق شركة/محادثة | لا اختلاط سياق | chunks شركة أخرى |
| AI-03 | إرسال بلا استحقاق/صلاحية | رفض عند التنفيذ | إرسال ناجح |
| AI-04 | تكرار إرسال | intent/claim يمنع التكرار الضار | إرسال مزدوج |
| AI-05 | سقف تكلفة | توقف قابل للقياس عند الحد | تجاوز بلا حد |
| AI-06 | أدوات حساسة | لا مسار غير مأذون | تصعيد أداة |

**إيضاح:** حد طول السؤال و`citations` **ليسا** حماية كافية من prompt injection؛ هما ضوابط مساعدة فقط. معيار AI-01 أعلاه هو المرجع.

تفعيل اختبار live AI مربوط بقرار مزوّد/ميزانية + تحقق env — لا يُستنتج من `launch-scope` وحده أن الإنتاج «مطفأ».

---

## 9. تشغيل، نسخ، استعادة، IR

| ID | بند | تعريف |
| --- | --- | --- |
| OPS-01 | Backup DB + Storage | مفعّل حسب سياسة المنصة؛ يُوثَّق المزود والإعداد |
| OPS-02 | قابلية الاستعادة | **UNVERIFIED** حتى نجاح restore drill موثّق — **ليست FAIL** لمجرد عدم الاختبار بعد |
| OPS-03 | RPO المستهدف | **≤ 24 ساعة** لبيانات العملاء/معرفة/فوترة (يُراجع إن تغيّر SLA تجاري) |
| OPS-04 | RTO المستهدف | **≤ 8 ساعات عمل** لاستعادة خدمة staging/prod الحرجة بعد فقدان منطقي |
| OPS-05 | دورية drill | **قبل كل إطلاق عملاء/دفع حي**؛ ثم **ربع سنوي** أو بعد تغيير بنيوي جوهري (migrations كبرى، تغيير مشروع Supabase، تغيير مزود backup) — **ليس** «مرة سنويًا تكفي» كافتراض |
| OPS-06 | Monitoring / Audit / IR | تنبيهات webhook/5xx/settle؛ تدقيق منح؛ تجميد أعلام؛ تدوير أسرار |

---

## 10. شروط بدء الاختبار (Entry)

1. Staging يعكس المخطط المراد إطلاقه (بما فيه ACCESS إن سيُطلق مع العملاء؛ billing إن سيُفعّل الدفع).
2. حسابات synthetic لعزل شركتين + أدوار.
3. Paymob Test فقط للمسار المالي؛ flags موثّقة.
4. **تحقق مكتوب** لقيم `WHATSAPP_*` / AI في بيئة الاختبار — لا افتراض «مطفأ».
5. Baseline: vitest + scripts isolation حيث ينطبق = PASS_LOCAL محفوظ.

---

## 11. معيار السماح بالإطلاق (Exit) — موحّد

يُسمح بالإطلاق **فقط** إذا:

1. **لا Critical ولا High مفتوحة** (FAIL بدون إصلاح+إعادة اختبار ناجحة).
2. **كل اختبار إلزامي** في هذه الخطة (ISO-01..03، PAY-01/02/04/05/06/07، WA-01، WEB-CSRF-01، ABUSE-01، OPS-02، وأي مسار live سيُفعَّل) لديه **دليل PASS_STAGING** (أو PASS على بيئة الإطلاق المعتمدة) — **لا إطلاق على NOT_RUN**.
3. بنود CODE_FIXED عليها **RETEST** ناجح قبل اعتبارها مغلقة.
4. قبول مخاطر **أدنى من High** فقط عبر سجل: **المسؤول، المدة، التعويضات، المتابعة** — القبول **لا** يحوّل FAIL إلى PASS ولا يغطي Critical/High.
5. ضوابط مكافحة الإساءة المطلوبة (ABUSE-01) **مُختبرة فعليًا** (ليس «مقررة على الورق» وحدها).

---

## 12. سجل عوائق / ملاحظات (2026-10-06) — بلا تضخيم

| بند | تصنيف | ملاحظة |
| --- | --- | --- |
| ACCESS FIX2 غير على الإنتاج | عائق إطلاق ميزات staff/scoped admin الجديدة | لا يعني تلقائيًا أن RLS القديم منهار |
| Billing سحابي غير مطبّق | عائق تفعيل دفع حي | المسار المحلي PASS_LOCAL ≠ إنتاج |
| إعدادات إرسال Meta | UNVERIFIED | تحقق env قبل أي ادعاء |
| Paymob FIX-01 | CODE_FIXED + PASS_LOCAL | RETEST_REQUIRED على staging قبل flags حية |
| Rate limit في التطبيق | NOT_OBSERVED_IN_REPO | ABUSE-01 إلزامي |
| Restore | UNVERIFIED | OPS-02 قبل الإطلاق |

---

## 13. ربط بالخطة الحالية

- مرحلة أخيرة بعد اكتمال الوظائف وقبل عملاء + دفع حقيقي.
- لا فحص هجومي على الإنتاج ضمن هذه الحزمة؛ لا تعديل تشغيل/نشر من هذه الوثيقة.

---

## 14. مراجع خارجية (مصلحة 2026-10-06)

| مصدر | رابط |
| --- | --- |
| OWASP ASVS (الرسمي) | https://github.com/OWASP/ASVS |
| ASVS 5.0.0 PDF | https://github.com/OWASP/ASVS/blob/master/5.0/OWASP_Application_Security_Verification_Standard_5.0.0_en.pdf |
| ASVS 5.0.0 CSV | https://github.com/OWASP/ASVS/blob/master/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv |
| OWASP ASVS project page | https://owasp.org/www-project-application-security-verification-standard/ |
| OWASP API Security | https://owasp.org/www-project-api-security/ |
| Supabase RLS | https://supabase.com/docs/guides/database/postgres/row-level-security |
| Supabase Auth SSR (Next.js) | https://supabase.com/docs/guides/auth/server-side/nextjs |
| Next.js Server Actions | https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations |
| Meta Webhooks | https://developers.facebook.com/docs/graph-api/webhooks/getting-started |
| Paymob Developers | https://developers.paymob.com/ |

---

*VEL-SECURITY-LAUNCH-PLAN-01 FIX-01 — planning artifact only. No production probing, ops changes, or deploy performed.*

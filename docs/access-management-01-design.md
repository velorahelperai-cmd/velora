# VEL-ACCESS-MANAGEMENT-01 — تصميم الصلاحيات

- الحالة: **FIX2 محلي — بانتظار اعتماد قرارات الترحيل** — لا تطبيق سحابي ولا ترقية مالك ولا نشر.
- التاريخ: 2026-10-06
- المشروع: `vmpifljyozsbtssxhoxd`
- مالك المنصة المقصود (للتهيئة المنفصلة فقط): `c7e6a5e5-8537-451d-b4e3-3c721f2b6eef`

**مهم:** الافتراضات والجداول أدناه للمراجعة فقط. وجودها في الوثيقة **≠ موافقة**.

---

## FIX2 — إضافات فوق FIX

| بند | الإصلاح |
| --- | --- |
| EXECUTE لمساعدات RLS | منح `can_admin_company(company,cap)` و`conversation_readable` لـ authenticated فقط |
| claim | إعادة عقد `ready→attempting`؛ `service_role` فقط؛ لا `sending`؛ فحوص link/generation |
| intent assistant | ممنوع على authenticated؛ مسار `create_whatsapp_assistant_send_intent` لـ service_role |
| `can_admin_company` | يتطلب **نطاق + usable capability**؛ ليس وجود النطاق وحده |
| `is_platform_admin` | بوابة UI فقط؛ البيانات عبر `can_admin_company` / `is_platform_owner` |
| منح مستقلة | مفوّض لا يستبدل منحة `manager_user_id is null` ولا يسرق منح مدير آخر |
| `access_add_company_staff` | `p_expected_grant_revision` إلزامي؛ فشل المنح → `RAISE` (rollback عضوية) |
| bootstrap | تحقق UUID+بريد؛ مالك آخر غير متوقع → **ABORT** بلا تعطيل |

---

## FIX — ما تغيّر عن v1 المعتمد سابقًا

| بند | v1 السابق | FIX |
| --- | --- | --- |
| `is_platform_admin()` | أي صف نشط في `platform_admins` | مالك نشط **أو** مفوّض نشط **وله ≥ نطاق شركة واحد** |
| تجاوز RLS/RPC | أدمن عام يرى كل الشركات | شركة عبر `can_admin_company`؛ بحث المنصة عبر `is_platform_owner` فقط |
| بذر موظفين | منح كل الصلاحيات في `company_member_grants` | **لا بذر**؛ جدول تحويل يحفظ السابق دون توسيع |
| `take_over` | يضع `assigned_to = uid` | لا يغيّر الإسناد؛ `assign` صلاحية مستقلة |
| أخطاء الخدمة | fallback إلى عضوية / `all_company` | fail-closed؛ توافق ما قبل الهجرة فقط بعلم صريح |
| revision | اختياري/متساهل | إلزامي + UPDATE مشروط |
| إلحاق موظف | ناقص | `access_add_company_staff` |

---

## مصفوفة الصلاحيات القابلة للمنح (v1 FIX)

فقط ما يُنفَّذ عبر خادم + RPC + RLS/Storage يظهر هنا. غير المنفَّذ **مستبعد**.

### شركة

| المفتاح | أين يُفرض | ملاحظات |
| --- | --- | --- |
| `wa.conversations.read` | RLS محادثات/رسائل + خادم inbox | أساس؛ مع `assigned_only` داخل السياسة |
| `wa.conversations.reply` | `create/claim` send intent + actions | يشترط `read` + نطاق المحادثة |
| `wa.conversations.take_over` | `control_whatsapp_conversation` | **لا** يمنح إسنادًا ذاتيًا |
| `wa.conversations.resume` | control RPC | |
| `wa.conversations.close` | control RPC | |
| `wa.conversations.assign` | control action `assign` | يغيّر `assigned_to` فقط |
| `knowledge.read` | RLS knowledge + Storage select | |
| `knowledge.write` | RLS insert/update + Storage write | |
| `knowledge.delete` | RLS/Storage delete | |
| `company.profile.read` | عضوية + فحوص خادم إعدادات | |
| `company.profile.write` | خادم إعدادات/تحديث شركة | |
| `company.staff.manage` | RPCs المنح/إلحاق موظف | |

**مستبعد من الكتالوج القابل للمنح:** `reports.read`, `wa.conversations.handoff` (لا سطح منتج كامل).

### منصة

| المفتاح | من | فرض |
| --- | --- | --- |
| `platform.manage_admins` | مالك فقط | `access_set_platform_role` / scopes |
| `platform.search_accounts` | مالك فقط | `admin_search_accounts` |
| `platform.manage_companies` | مالك أو مفوّض بنطاق | قوائم/تفاصيل مقيّدة بـ `can_admin_company` |
| `platform.manage_access` | مالك أو مفوّض بـ `company.staff.manage` تفويضًا | منح موظفين ضمن النطاق |
| `platform.view_audit` | مالك (v1) | قراءة تدقيق مقيّدة |

---

## مصدر المنح (fail-closed)

صلاحية الموظف تتطلب **كل** الآتي:

1. عضوية `company_members` نشطة (`staff`)
2. صف `company_member_grants` نشط يحتوي المفتاح
3. نطاق الشركة صالح
4. إن كان `manager_user_id` مضبوطًا: المفوّض ما زال نشطًا وله نطاق على الشركة والمفتاح ما زال في `delegable_capabilities`
5. لمجال المحادثة: `all_company` أو `assigned_to = auth.uid()`

- `manager_user_id` يُضبط **خادميًا فقط**: `null` إن صدر من مالك منصة/مالك شركة (مستقل)؛ وإلا `auth.uid()` للمفوّض. تجاهل قيمة العميل.
- سحب نطاق/تعطيل مفوّض → تعطيل المنح التابعة له؛ الإبقاء على `manager_user_id is null`.
- مالك الشركة: صلاحيات الشركة ضمنيًا بلا صف منح.

---

## جدول التحويل (لا توسيع)

`access_staff_capability_conversion` يحفظ لقطة **سابقة فعّالة** للموظفين النشطين دون كتابتها في `company_member_grants`.

**اقتراح لقطة (للمراجعة — غير معتمد):**  
`read/reply/take_over/resume/close` + `knowledge.read` + `company.profile.read`، نطاق `all_company`.  
لا تشمل `assign` / `knowledge.write|delete` / `company.staff.manage` (لم تكن ممنوحة سابقًا عبر عضوية عامة بنفس القدر).

التطبيق على المنح يتم فقط عبر حزمة bootstrap الذرّية المنفصلة.

---

## Bootstrap ذرّي (اعتماد منفصل)

ملف مقترح: `artifacts/VEL-ACCESS-MANAGEMENT-01/bootstrap_owner_and_conversion.sql`

معاملة واحدة:

1. ترقية المالك المقصود + قفل revision
2. تطبيق صفوف التحويل → `company_member_grants` مستقلة (`manager_user_id null`)

لا فترة بلا مالك صالح بعد الاعتماد؛ لا خطة استعادة بالرجوع إلى boolean admin.

---

## توافق ما قبل الهجرة (صريح فقط)

- المتغير: `VEL_ACCESS_MIGRATION_COMPAT=1` (**معطّل افتراضيًا**)
- يُفعّل فقط عند غياب دالة محددة بالاسم (`has_company_capability` / `company_conversation_scope`) — لا مطابقة عامة لكلمة `pgrst`
- بعد وجود الهجرة: أي فشل صلاحية يمنع الإجراء؛ **لا** رجوع إلى `all_company`

---

## قرارات ترحيل — ترشيح للتنفيذ (بانتظار اعتمادك)

| # | القرار | الترشيح |
| --- | --- | --- |
| 1 | لقطة التحويل | محدودة تحفظ السابق: read/reply/take_over/resume/close + knowledge.read + company.profile.read، نطاق `all_company` |
| 2 | بحث/ملخص المنصة العالمي | **مالك فقط** |
| 3 | bootstrap + التحويل | **عملية ذرّية واحدة** معتمدة مع الهجرة (بعدها مباشرة في نفس نافذة الاعتماد) |
| 4 | علم التوافق | **معطّل افتراضيًا**؛ إن لزم: غياب دالة محددة بالاسم فقط |

**لا تطبيق حتى ترد بالاعتماد الصريح على الجدول أعلاه.**

**اختبارات SQL على بيئة اختبار مأذونة:**  
`artifacts/VEL-ACCESS-MANAGEMENT-01/sql_tests_fix2.sql` + `run_sql_tests.ps1`  
تتطلب `ACCESS_FIX2_TEST_DATABASE_URL` لمشروع رمي منفصل.  
**تشغيل هذه الجلسة:** `ACCESS_FIX2_SQL_TESTS_NOT_RUN` (لا Docker، لا URI اختبار) — **لا نجاح مُعلَن.** الإنتاج `vmpifljyozsbtssxhoxd` محظور كصندوق اختبار.

---

## قيود ثابتة

لا Obsidian، لا تطبيق سحابي، لا ترقية مالك، لا نشر، لا إرسال/توكنات ضمن هذه الحزمة حتى تأمر صراحة.
لا مساس بمسار استقبال الرسائل العامل ولا بعضوية الاختبار الحالية.

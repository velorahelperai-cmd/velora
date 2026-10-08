# تشغيل دفع الاشتراك التجريبي — Paymob Oman

التصميم ومسار Checkout جاهزان في الكود. لم تُجرَ معاملة Paymob فعلية ولم تُطبق الهجرة الجديدة على قاعدة سحابية، لأن مفاتيح Test غير موجودة محليًا.

## ما تحتاج استخراجه

1. افتح حساب Paymob Oman الخاص بالمشروع، واختر بيانات Test.
2. من Developers / API Keys: Secret Key الخاص بالاختبار وPublic Key الخاص بالاختبار. يجب أن يشيرا إلى Test؛ الكود يرفض مفاتيح Live.
3. من Developers / Payment Integrations: Integration ID لطريقة دفع Test وبعملة OMR، وMerchant Owner ID.
4. استخرج HMAC Secret من إعدادات الحساب. إن لم يظهر، اطلبه من دعم Paymob؛ لا تستبدله بـ API Key.
5. أكد مع إعداد الحساب أو دعم Paymob عدد وحدات amount API لكل 1 OMR. لا نفترض أن بيسة واحدة تساوي وحدة provider واحدة. لا تُفعّل CONVERSION_VERIFIED قبل التحقق من القيمة.

مرجع رسمي: [Create Intention](https://developers.paymob.com/paymob-docs/intention-apis/create-intention) و[FAQ](https://developers.paymob.com/paymob-docs/need-help/faqs).

## حفظ الإعدادات

أضف القيم محليًا إلى `.env.local` أو إلى متغيرات البيئة السرية في بيئة الاختبار. لا ترسل Secret Key أو HMAC Secret في المحادثة ولا تحفظهما في Git.

```dotenv
PAYMOB_SECRET_KEY_TEST=
PAYMOB_PUBLIC_KEY_TEST=
PAYMOB_INTEGRATION_ID_TEST=
PAYMOB_MERCHANT_OWNER_ID=
PAYMOB_HMAC_SECRET=
PAYMOB_OMR_UNITS_PER_OMR=
PAYMOB_OMR_CONVERSION_VERIFIED=false
BILLING_PAYMOB_CREATE_ENABLED=false
BILLING_PAYMOB_WEBHOOK_ENABLED=false
BILLING_PAYMOB_SETTLE_ENABLED=false
BILLING_PAYMOB_LIVE_ENABLED=false
PAYMOB_LIVE_ENABLED=false
PAYMOB_API_BASE_URL=https://oman.paymob.com
PAYMOB_CHECKOUT_BASE_URL=https://om.checkout.paymob.com
NEXT_PUBLIC_SITE_URL=https://YOUR-TEST-HOST
```

بعد اكتمال المفاتيح وتأكيد العملة وتجهيز قاعدة الاختبار، اضبط CONVERSION_VERIFIED وأعلام CREATE/WEBHOOK/SETTLE إلى true. احتفظ بأعلام Live على false.

## تجهيز البيئة

- طابق الهجرات الموجودة مع المخطط الفعلي قبل التطبيق. يحتاج Checkout هجرات billing السابقة، ثم `supabase/migrations/20261007010000_vel_paymob_test_checkout.sql`؛ لا تطبق ملفًا على قاعدة مجهولة أو سلسلة ناقصة.
- الهجرة الجديدة تضيف تثبيت مبلغ provider عند INSERT، وجدول Test checkout ووظائف claim/complete خاصة بالخادم؛ لا تغير قفل المبالغ بعد إنشاء الطلب.
- تحتاج الباقات نسخًا منشورة في الكتالوج الحقيقي. صفحة العميل لا تستخدم أسعار معاينة التصميم.
- استخدم شركة اختبار ومالكًا مسجلًا ورقم هاتف للشركة، وبيانات لا تخص العملاء الحقيقيين.
- انشر النسخة على عنوان HTTPS لبيئة الاختبار. callback عام مطلوب لتوصيل Paymob إلى الخادم؛ localhost وحده لا يستقبل إشعارات المزود.
- مسار الإشعار: `/api/billing/paymob/webhook`؛ ينشئ الخادم رابط العودة الخاص بالطلب إلى `/app/subscription/orders/<orderId>`.
- أعد تشغيل الخادم بعد تحديث الإعدادات.

## تجربة القبول

1. سجل الدخول بصفة مالك شركة الاختبار وافتح `/app/settings?tab=plan`.
2. اختر الشخصية والمستوى؛ تأكد أن السعر والحدود هما النسخة المنشورة.
3. اضغط «متابعة للدفع التجريبي»؛ يجب فتح Hosted Checkout الخاص بـ Paymob Test.
4. استخدم بيانات اختبار البطاقات من Paymob الرسمية، ثم انتظر webhook وافتح صفحة حالة الطلب واضغط تحديث الحالة. تتم محاولة التسوية تلقائيًا بعد التحقق وحفظ الحدث، وصفحة الطلب تعيد محاولة معالجة الحدث المخزن إذا تعثرت التسوية.
5. لا يعتبر النجاح في عنوان العودة دليلًا؛ الحالة تعتمد على الإشعار الموثوق والتسوية المخزنة.
6. جرّب الفشل والإلغاء والتكرار والطلب غير المحسوم وشركة أخرى. لا تنشئ محاولة جديدة لطلب مجهول النتيجة.

الدفع التجريبي لا يفعّل Meta/AI الحي أو الدفع الحقيقي. التجديد المبكر والترقية لا يُفتحان ضمن هذا التعديل.

## المعاينة والفحوص

- `/preview/subscription` متاح في development فقط، ببيانات وأسعار توضيحية معلّمة بوضوح؛ الدفع معطل فيه.
- الفحوص المحلية: TypeScript، lint للملفات المعدلة، build، اختبارات الفوترة وCheckout.
- SQL الجديد جرى تشغيله في PGlite مع مخطط fixture مصغر لاختبار التثبيت والعزل والقفل والحفظ والصلاحيات. هذا ليس إثبات تطبيق الهجرات أو تسوية معاملة فعلية على بيئة الاختبار.


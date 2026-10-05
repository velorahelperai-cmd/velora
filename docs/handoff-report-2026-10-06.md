# تقرير تسليم Velora — 6 أكتوبر 2026

جاهز للنسخ والإرسال.

## الخلاصة

**Meta وAI جاهزان للتكامل في الكود** (مسارات خادمية وعقود ونقاط توصيل)، والتشغيل الحي مطفأ حتى تطبيق الهجرات واعتماد Vault/المزوّد.

ما يعمل للإطلاق الآن: حساب، شركة، معرفة، مراجعة، `/app` و`/admin` من مصادر حقيقية. واتساب والاشتراك والرد الحي يظهرون **غير مجهّز / NEEDS_SETUP** — ليست واجهة نجاح وهمية.

آخر نشر معروف: `217eafb` على velorahelper.com. هجرات واتساب الجديدة غير مطبّقة.

## جاهزية تكامل Meta (pathReady=true، liveReady=false)

- توجيه `tenant_registry` موصول في الكود؛ الافتراضي `single_tenant`.
- Resolver + intents + جيل الربط + تصنيف فشل ما قبل Graph.
- عقد أسرار: مرشح Vault، النشط `unconfigured`.
- Embedded Signup v4: عقد + زر معطّل؛ هجرة محاولات `20261006020000` غير مطبّقة.
- نقاط: `resolveWhatsappCompanyByProviderPhone`، `lookupWhatsappAccessSecret`، `embeddedSignupClientConfig`، `replyWhatsappConversation`.
- متغيرات لاحقة (لا تُضبط هنا): انظر `META_LIVE_ENV_CONTRACT` في `src/lib/ops/integration-readiness.ts`.

## جاهزية تكامل AI (pathReady=true، liveReady=false)

- `AnswerProvider` / `askCompanyAnswer` / `channel-adapter` / عزل المحادثة.
- `answerRuntimeSetup()` و`getAnswerProvider()` = null حتى اعتماد المزوّد+الموديل+الميزانية.
- عامل داخلي غير مجدول؛ استحقاق `not_configured`.
- نقاط: `getAnswerProvider`، `processInboundJobAnswer`، `runInboundWorkerAnswer`.

## سجل القرار

`src/lib/ops/pending-decisions.ts` · `src/lib/ops/launch-scope.ts` · `src/lib/ops/integration-readiness.ts`

## لتفعيل الحي لاحقًا (موافقة منفصلة)

1. تطبيق: 101500 → 103000 → 120000 → 140000 → 06010000 → 06020000  
2. اعتماد Vault لأسرا كل شركة/رقم/جيل  
3. اعتماد مزوّد + موديل + ميزانية AI  
4. ثم فقط: `tenant_registry`، `WHATSAPP_ALLOW_EXTERNAL_SEND`، Embedded Signup، إجابة حية  

160000 حسابات الأدمن: موافقة منفصلة.

## فحوص

vitest (بما فيها integration-readiness) · typecheck · lint · build  
ليست PASS: متصفح، Meta/AI حي، RLS بشركتين، نشر تلقائي.

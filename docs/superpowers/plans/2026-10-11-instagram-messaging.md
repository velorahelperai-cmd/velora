# Instagram Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ربط حساب Instagram المهني لكل شركة واستقبال الرسائل والرد اليدوي داخل فيلورا مع تخزين دائم وعزل الشركات.

**Architecture:** تخزين Instagram مستقل عن جداول WhatsApp، مع Vault للرموز وRPCs تتحقق من العضوية والصلاحيات. تفويض المالك يثبت الحساب والشركة، وWebhook موقّع يحفظ الأحداث ذريًا، وواجهة المحادثات تستخدم محولات قناة. الإرسال يمر بنية دائمة ومحاولة واحدة مع حالة unknown قابلة للتسوية.

**Tech Stack:** Next.js 16.3.8، React 19.3.0، TypeScript 6.0.3، Supabase/PostgreSQL/Vault، Vitest 3.2.4، Meta Instagram API.

**Spec:** `docs/superpowers/specs/2026-10-11-instagram-messaging-design.md`

## Global Constraints

- الرسائل الخاصة النصية والرد اليدوي فقط في الإصدار الأول؛ التعليقات والنشر والرؤى والتسويق وAI خارج النطاق.
- لا مكالمات AI مدفوعة، ولا تفعيل لعملاء WhatsApp أو Instagram تلقائيًا.
- لا قراءة أو بحث أو تعديل لأي محتوى تحت Obsidian.
- اقرأ دليل Next المثبت في `node_modules/next/dist/docs/` لكل API متأثر قبل كتابة الكود.
- لا رمز Instagram عالمي كبديل عن تفويض الحساب المرتبط؛ أسرار الحسابات في Vault فقط.
- لا توريث لمنح WhatsApp إلى Instagram؛ العضوية والصلاحيات ونطاق المحادثة تتحقق على الخادم وفي القاعدة.
- الحساب الحالي في فيلورا موظف؛ تجربة الربط تتطلب مالك شركة مثبتًا دون ترقيته تلقائيًا.
- لا إرسال فعلي تلقائي في الاختبارات؛ المزود محاكى. تجربة استقبال/رد فعلية تحتاج رحلة اختبار محددة ومصرحًا بها.
- حالة unknown لا تُعاد آليًا؛ accepted لا تعني delivered.
- migrations أمامية؛ التراجع يغلق القناة ويحفظ تاريخها.

## Review Focus

1. انتهاء أو سحب العضوية بين فتح الصفحة وdispatch: يرفض الخادم الإجراء؛ يختبر في المهمتين 2 و5.
2. حدث قديم بعد تجديد الربط: لا يلغى الجيل الجديد ولا يعاد توجيهه لشركة أخرى؛ يختبر في المهمتين 2 و3.
3. وصول صدى أو receipt قبل نتيجة HTTP: تتلاقى النتيجتان في نية واحدة دون فقد رسالة أو خفض حالتها؛ يختبر في المهمتين 3 و5.
4. معرف مرسل واحد في حسابين مهنيين: يبقى تاريخ كل حساب وشركة منفصلًا؛ يختبر في المهمتين 3 و4.
5. تغيير الإسناد أو الشركة أثناء paging: لا يسرب cursor رسائل جديدة خارج النطاق، ولا يتقدم مؤشر القراءة على المعروض؛ يختبر في المهمة 4.

---

## خريطة الملفات والعقود

ملفات جديدة في `src/lib/instagram/`: `contracts.ts` للأنواع؛ `config.ts` للإعداد المغلق افتراضيًا؛ `meta.ts` للمزود؛ `oauth.ts` لتنسيق التفويض؛ `store.ts` لاستدعاءات القاعدة؛ `actions.ts` للجلسة والصلاحيات؛ `webhook.ts` لتحليل الأحداث؛ `inbox.ts` للقراءة؛ `send.ts` لتنسيق الإرسال. اختبارات Vitest مجاورة لكل وحدة.

مسارات جديدة: `src/app/api/instagram/oauth/callback/route.ts` و`src/app/api/instagram/webhook/route.ts` مع اختبارات routes مجاورة. بطاقة الربط: `src/components/app/instagram-settings-panel.tsx`.

تعديلات الواجهة: `src/components/app/settings.tsx`، `conversations.tsx`، `conversations-inbox.ts`، `conversations-async.ts`. عقود القنوات المشتركة الجديدة في `src/lib/channels/inbox.ts`؛ محول WhatsApp يعتمد عقوده الحالية دون تغيير مفاتيح هويته أو RPCs الخاصة به.

قاعدة البيانات: migrations جديدة تحت `supabase/migrations/` للأمان والربط، الأحداث والمحادثات، ثم نيات الإرسال. أسماء الملفات المقترحة `20261011230000_instagram_links.sql`، `20261011231000_instagram_inbox.sql`، `20261011232000_instagram_send.sql`؛ افحص عدم تعارض التوقيت مع العمل الجاري قبل إنشائها. فحوص PostgreSQL في `scripts/instagram-integration/contracts.sql` و`concurrency.mjs` مع runner محلي لا يتصل بمزود.

أنواع العقود الأساسية في `contracts.ts`:

```ts
type InstagramIdentity = { companyId: string; userId: string; sessionId: string };
type InstagramBinding = { companyId: string; accountId: string; generation: number };
type InstagramFailure = { ok: false; code: string };
type InstagramSendOutcome =
  | { status: "accepted"; providerMessageId: string }
  | { status: "rejected"; code: string }
  | { status: "unknown"; code: string };
```

## Task 1: تثبيت عقد Meta والإعدادات

**Files:** Create `src/lib/instagram/contracts.ts`, `config.ts`, `meta.ts`, `config.test.ts`, `meta.test.ts`; create `docs/integrations/instagram-provider-contract.md`.

**Interfaces:** ينتج `readInstagramConfig(env): InstagramConfig | InstagramFailure`، و`createInstagramMeta(config, fetchImpl): InstagramMetaPort`. المنفذ يعرّف `exchangeCode(code, redirectUri)`، `inspectAccount(token)`، `subscribeAccount(accountId, token)`، `refreshToken(token)`، `sendText(accountId, recipientId, text, token): Promise<InstagramSendOutcome>`. نتائج التفويض تحمل accountId/appId/scopes/expiresAt/token على الخادم فقط.

- [ ] اقرأ وثائق Meta الرسمية الحالية بالمتصفح: OAuth وتبادل/تجديد الرمز ونوع الحساب والصلاحيات والتوقيع والأحداث ونافذة الرد وحدود النص. سجّل روابط المصادر وتاريخ التحقق والإصدار في وثيقة العقد. لا تخمن من API WhatsApp؛ توقف قبل adapter إذا تعذر إثبات العقد.
- [ ] اقرأ أدلة Next المثبتة لـ Route Handlers وcookies وServer Actions وenvironment variables. افحص فرع Git/worktree الجاري وأنشئ عزل التنفيذ وفق using-git-worktrees دون مساس بعمل آخر.
- [ ] اكتب اختبارات `config.test.ts`: غياب السر أو الإصدار الصريح يعطي NEEDS_SETUP؛ مفاتيح connect/receive/send مغلقة افتراضيًا؛ لا يُعاد secret للعميل. في `meta.test.ts` ثبّت requests/fixtures من العقد الرسمي، ورفض app/account/scopes غير المطابقة، وتمييز timeout بعد dispatch كـunknown دون retry.
- [ ] شغّل `npx vitest run src/lib/instagram/config.test.ts src/lib/instagram/meta.test.ts`؛ تأكد من فشل العقود الجديدة قبل تنفيذها.
- [ ] نفّذ الأنواع والإعداد والمنفذ باستخدام fetch محقون، وقت انتهاء صريح، وتسجيل رموز أخطاء منقحة فقط. عرّف `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_GRAPH_VERSION`, `INSTAGRAM_VERIFY_TOKEN`, `INSTAGRAM_CONNECT_ENABLED`, `INSTAGRAM_RECEIVE_ENABLED`, `INSTAGRAM_SEND_ENABLED`.
- [ ] أعد أمر الاختبار وتأكد من نجاحه؛ commit `feat: define verified Instagram provider contract`.

## Task 2: تفويض المالك والربط الدائم

**Files:** Create links migration, `store.ts`, `oauth.ts`, `actions.ts`, `oauth.test.ts`, `actions.test.ts`, callback route/tests, PostgreSQL runner و`contracts.sql`.

**Interfaces:** `startInstagramConnect(companyId): Promise<{ok:true;authorizeUrl:string}|InstagramFailure>`؛ `finishInstagramConnect(identity:InstagramIdentity, input:{state:string;code:string}): Promise<{ok:true;binding:InstagramBinding}|InstagramFailure>`؛ `disconnectInstagram(companyId)`؛ `getInstagramSetup(companyId)` يعيد حالة منقحة فقط. `store.ts` ينتج ports للبدء/claim/finalize/قراءة السر المقيدة/الفصل والتجديد.

- [ ] اكتب فحوص PostgreSQL للمالك/الموظف، جلسة مختلفة، replay وانتهاء nonce، شركتين تتنافسان على حساب واحد، Vault ACL، تجديد الجيل والفصل مع حفظ التاريخ. assertions: authenticated/anon لا يقرآن السر، claim يستخدم مرة واحدة، finalize لا يحفظ ربطًا غير مثبت، الحدث القديم لا يغير الجيل الجديد.
- [ ] اكتب اختبارات callback: state ناقص/مزور، رفض المزود، session غير مطابقة، فشل finalize بعد exchange => reconciliation_required دون exchange ثانٍ؛ URL العودة ثابت دون open redirect أو code/token في logs. اكتب اختبار فقد العضوية بين start وfinish.
- [ ] شغّل `npx vitest run src/lib/instagram/oauth.test.ts src/lib/instagram/actions.test.ts src/app/api/instagram/oauth/callback/route.test.ts`؛ شغّل runner المحلي على PostgreSQL اختباري قبل migration وتأكد من الفشل المتوقع. يجب أن يتطلب runner هدفًا محليًا صريحًا ويرفض production افتراضيًا.
- [ ] نفّذ `instagram_links` و`instagram_oauth_attempts` مع uniqueness للحساب النشط، nonce hash وانتهاء واستهلاك، RLS وSECURITY DEFINER/search_path ثابت وACL محدود. finalize يحفظ Vault secret والربط في معاملة؛ احصر Secret RPC في service_role واربطها بالشركة والحساب والجيل. استخدم نظام session guard والمالك الحالي دون منح أدمن المنصة ملكية شركة.
- [ ] نفّذ refresh/finalize المقيّد بالجيل، والفصل الذي يمحو السر المحلي ويحفظ التاريخ. قيد callback بجلسة ومحاولة مستهلكة ومعرف التطبيق والحساب والحقول المثبتة بالمهمة 1.
- [ ] أعد اختبارات الوحدة وPostgreSQL ونجاح جميع assertions؛ commit `feat: persist owner-authorized Instagram connections`.

## Task 3: استقبال Webhook وحفظ الرسائل

**Files:** Create inbox migration, `webhook.ts`, `webhook.test.ts`, webhook route/tests؛ extend `store.ts`, `contracts.ts`, `scripts/instagram-integration/contracts.sql`, `concurrency.mjs`.

**Interfaces:** `parseInstagramEvents(raw:unknown): InstagramEvent[]` بأنواع مثبتة من المهمة 1؛ `persistInstagramEvent(event): Promise<{status:"stored"|"duplicate"|"ignored"|"retry"}>`. event يحمل receiverAccountId/providerEventId/providerMessageId/providerTimestamp وبيانات نصية أو نوع غير مدعوم. الربط والشركة يُحلّان داخل القاعدة، ولا يقبل companyId من الحدث.

- [ ] اكتب الاختبارات: توقيع غير صحيح => رفض دون DB؛ تحدي GET صحيح => challenge؛ supported save transient failure => retry HTTP؛ duplicate/concurrent => رسالة واحدة؛ sender ID نفسه في حسابين => محادثتان منفصلتان؛ echo لا ينشئ رسالة واردة ثانية؛ receipts قبل/بعد accepted لا تخفض الحالة؛ حدث قديم لا يوقف جيلًا مجددًا.
- [ ] شغّل `npx vitest run src/lib/instagram/webhook.test.ts src/app/api/instagram/webhook/route.test.ts` وفحوص القاعدة/التزامن المحلية لتوثيق الفشل.
- [ ] نفّذ `instagram_conversations`, `instagram_messages`, `instagram_message_events` بمفاتيح account+sender/provider message المناسبة وtransaction واحدة للحفظ والتحديث. لا تخزن raw payload أو attachment body تلقائيًا؛ احتفظ بالحد الأدنى المثبت للتشخيص/التسوية.
- [ ] نفّذ GET للتحقق وPOST raw-body signature قبل JSON. ضع حدًا للحجم حسب عقد المشروع، واحفظ حالة كل حدث مدعوم قبل acknowledgment؛ أقرّ ignored فقط بعد التحقق من التوقيع. طبّق routing إلى ربط مثبت نشط مع منع echo وحالات الجيل القديم.
- [ ] أعد الاختبارات وفحوص PostgreSQL والتزامن؛ commit `feat: receive signed Instagram messages durably`.

## Task 4: المحادثات وبطاقة الربط وصلاحيات الشركة

**Files:** Create `src/lib/channels/inbox.ts`, `src/lib/instagram/inbox.ts`, `inbox.test.ts`, settings panel/tests؛ modify settings/conversations components المذكورة في الخريطة، `src/lib/access/capabilities.ts` و`conversation-scope.ts`؛ extend inbox migration وSQL checks.

**Interfaces:** `InboxChannel = "whatsapp" | "instagram"`؛ `readInstagramInbox({companyId,cursor,limit})` و`readInstagramThread({companyId,conversationId,cursor,limit})` يعيدان rows/cursor/scopeFingerprint وحالة فشل صريحة. `markInstagramRead({companyId,conversationId,throughMessageId})` و`assignInstagramConversation({companyId,conversationId,memberId})` يخضعان للنطاق والعضوية في القاعدة.

- [ ] اكتب اختبارات isolation والقدرات `ig.conversations.read`, `ig.messages.reply`, `ig.conversations.assign`, `ig.connection.manage`: موظف بلا منح لا يرى القناة؛ owner فقط يدير الربط؛ assigned_only يخفي غير المسندة؛ تبديل الشركة/الإسناد يبطل cursor؛ read marker لا يتجاوز الرسائل المعروضة؛ لا تسريب عبر count/diagnostics.
- [ ] اكتب اختبارات مكون تعرض connected/needs_setup/expired/reconciliation_required بصدق، تمنع double-start، تفصل قوائم القنوات، وتعرض unsupported media دون ادعاء قراءة محتواها. ثبّت عدم تغيير رحلة WhatsApp ونتائج عقوده.
- [ ] شغّل اختبارات المهمة الجديدة والاختبارات الحالية `src/components/app/conversations-inbox.test.ts`, `conversations-async.test.ts`, `src/lib/whatsapp/inbox-contracts.test.ts` وفحوص RLS؛ تأكد من فشل المطلوب الجديد.
- [ ] نفّذ RPCs قائمة/thread/read/assign والنطاق fail-closed باستخدام نظام صلاحيات المشروع. امنح صلاحيات الموظفين فقط عبر إدارة صلاحيات الشركة القائمة المصرح بها، ولا توسع منحًا تاريخية. أضف UI channel adapter وبطاقة OAuth دون إعادة بناء شاملة لواتساب.
- [ ] أعد الاختبارات وفحوص القاعدة؛ commit `feat: expose authorized Instagram inbox and connection settings`.

## Task 5: الرد اليدوي ونية الإرسال والتسوية

**Files:** Create send migration، `send.ts`, `send.test.ts`؛ extend actions/store/webhook وواجهة المحادثات؛ add PostgreSQL intent concurrency checks.

**Interfaces:** `replyInstagram({companyId,conversationId,text,idempotencyKey}): Promise<{ok:true;intentId:string;outcome:InstagramSendOutcome}|InstagramFailure>`؛ `dispatchInstagramIntent(intentId): Promise<InstagramSendOutcome|InstagramFailure>`. claim RPC يرجع حسابًا/جيلًا/مستلمًا/نية مخولة؛ settle RPC يقبل فقط نتيجة النية والحساب والجيل المثبتة.

- [ ] اكتب اختبارات: idempotencyKey واحد => محاولة واحدة؛ انقطاع بعد dispatch => unknown محفوظ دون retry؛ سحب عضوية/إسناد/تفويض/استحقاق أو انتهاء نافذة قبل الإرسال => منع provider call؛ accepted ليس delivered؛ receipt مبكر يلتقي بالنية نفسها؛ reconnect لا يطبق نتيجة قديمة على الربط الجديد. النص الفارغ والمتجاوز حدود المزود يرفضان قبل dispatch.
- [ ] شغّل `npx vitest run src/lib/instagram/send.test.ts src/lib/instagram/actions.test.ts` وفحوص PostgreSQL لسباق claim/settle؛ تأكد من الفشل قبل التنفيذ.
- [ ] نفّذ `instagram_send_intents` وRPCs prepare/claim/settle ومفاتيح المنع والنتائج accepted/rejected/unknown. claim يعيد فحص العضوية والنطاق وحالة الشركة والاستحقاق التجاري الفعلي من قارئ المشروع ونافذة العقد والجيل. لا يستعمل ميزانية AI أو bypass جديدًا للاستحقاق.
- [ ] نفّذ محاولة provider واحدة وتثبيت unknown عند نتيجة مبهمة؛ اربط receipt/providerMessageId بنيته بدقة. أضف عرض نتيجة الإرسال الصادقة وزر الرد المحكوم بالصلاحية؛ لا تضف زر retry للنتيجة المبهمة دون مسار تسوية مثبت.
- [ ] أعد الاختبارات وفحوص القاعدة والتزامن؛ commit `feat: send Instagram replies with durable authorization and outcomes`.

## Task 6: التحقق والنشر وإكمال Meta

**Files:** Create `docs/releases/2026-10-11-instagram-messaging.md` و`docs/integrations/instagram-meta-review.md`؛ update ملف النوت المحلي خارج Git، `.env.example` إن وجد بعد فحصه.

**Interfaces:** يستند النشر إلى config/readiness الخاصة بالمهمة 1، والروابط الفعلية `/api/instagram/oauth/callback` و`/api/instagram/webhook`. لا توجد قيمة token لعميل في env؛ لا تسجل أسرار في evidence.

- [ ] شغّل suite Instagram، اختبارات WhatsApp المتأثرة، PostgreSQL isolation/concurrency، `npm run typecheck`, `npm run lint`, `npm run build`. سجّل النتائج الفعلية؛ أي فشل مادي يُصلح قبل إعلان الجاهزية. لا تشغّل suites opt-in التي تستدعي AI مدفوعًا.
- [ ] راجع migrations/ACL/Vault ومطابقة schema للسحابة قراءةً أولًا، ثم طبّق migrations الجديدة ضمن النطاق المصرح. لا تعتبر وجود RPC واتساب دليلًا على مطابقة schema إنستغرام. راجع diff مستقلًا قبل التطبيق والنشر.
- [ ] أضف أسرار الخادم عبر وسيلة آمنة بعد تأكيد نطاق إنشاء/حفظ أي credential جديد، وانشر المسارات والإعداد مع connect/receive/send مغلقة. تحقق من النسخة Production وreadiness دون إرسال؛ سجل commit/deployment وروابط العودة.
- [ ] سجل callback وWebhook الحقيقيين في Meta بعد إثبات تشغيلهما؛ فعّل connect/receive للحساب التجريبي فقط وفق سياسة الإطلاق. المالك المثبت ينفذ OAuth، ثم تحقق أن Vault يحمل الربط وأن UI يعرض الحساب الصحيح دون رمز.
- [ ] عند تفويض تجربة فعلية محددة: أرسل رسالة من حساب اختبار إلى الحساب المهني، تحقق من ورود نسخة واحدة وتاريخها وشركتها، فعّل الرد التجريبي المقيّد ثم نفذ ردًا يدويًا واحدًا وتحقق من Meta ومن المستلم. لا تعلن تسليمًا من HTTP accepted وحده.
- [ ] جهّز فيديو وتعليمات المراجع من الرحلة الفعلية، وأكمل عناصر App Review الناقصة حسب لوحة Meta. لا ترسل طلبًا يعتمد على وظائف غير منفذة؛ لا تعتبر pending Tech Provider موافقة على كل scope.
- [ ] حدّث النوت: المنفذ/الناقص، الروابط وIDs، حالة كل flag، تاريخ انتهاء الرمز، نتيجة التجربة. تحفظ الأسرار في النوت الخاص الموجود خارج Git فقط. راجع سياسة الاحتفاظ والحذف ومسار الفصل؛ rollback يغلق الإرسال والاستقبال ولا يمحو البيانات.

## مراجعة الخطة وطريقة التنفيذ

الخطة تغطي OAuth/Vault والجيل، توقيع الأحداث والتكرار، UI/الصلاحيات، الإرسال والاستحقاق والنتيجة المبهمة، ثم نشرًا مغلقًا وتجربة مالك ومراجعة Meta. تفاصيل المزود غير المثبتة شرط صريح في المهمة 1 قبل كتابة adapter؛ إذا غيّرت الوثائق النطاق، يراجع التصميم أولًا.

المقترح تنفيذ مباشر في الجلسة باستخدام executing-plans لتتابع العقود والقاعدة، مع مراجعة مستقلة للتغييرات قبل النشر. يمكن بدلًا منه اختيار تنفيذ بمهام مفوضة ومراجعة كل مهمة. التنفيذ ينتظر مراجعة المستخدم للخطة واختيار طريقته وفق writing-plans.

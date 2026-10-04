import type { Locale } from "@/lib/i18n";

export type SectorId = "restaurant" | "retail" | "services";
export type PlanId = "support" | "expanded" | "integrated";

type Pair = { ar: string; en: string };

function t(locale: Locale, pair: Pair): string {
  return pair[locale];
}

const scenes = [
  {
    id: 1,
    key: "pressure",
    theme: "dark" as const,
    anchor: "story",
    title: {
      ar: "كل تأخر في الرد قد يخسّرك العميل.",
      en: "A late reply can cost you the customer.",
    },
    body: {
      ar: "الأسئلة تتكرر والفريق مشغول. من هنا تبدأ الحكاية بسؤال واحد بلا جواب.",
      en: "Questions repeat and the team is busy. The story starts with one question and no answer.",
    },
    example: {
      ar: {
        question: "البرجر الكلاسيك متوفر اليوم؟",
        answer: "بانتظار الرد",
        cardTitle: "بانتظار الرد",
        card: "سؤال العميل ظاهر، ولم يُجمع بعد أي تفصيل.",
      },
      en: {
        question: "Is the classic burger available today?",
        answer: "Waiting for a reply",
        cardTitle: "Waiting for a reply",
        card: "The customer’s question is visible, and no detail has been collected yet.",
      },
    },
    chips: {
      ar: ["متوفر اليوم؟", "كم السعر؟", "متى يوصل؟", "التوصيل فين؟", "أقدر أطلب؟"],
      en: ["Available today?", "What’s the price?", "When does it arrive?", "Where do you deliver?", "Can I order?"],
    },
  },
  {
    id: 2,
    key: "knowledge",
    theme: "light" as const,
    anchor: "how",
    title: { ar: "معلومة نشاطك تجيب نفس السؤال.", en: "Your business information answers the same question." },
    body: {
      ar: "مثال توضيحي: معلومات الشركة تُحفظ وتُراجع قبل أي تفعيل. لا يُرسل رد آلي للعميل الآن.",
      en: "Illustrative example: company information can be saved and reviewed before any activation. No automatic reply is sent to a customer now.",
    },
    example: {
      ar: {
        question: "البرجر الكلاسيك متوفر اليوم؟",
        answer: "نراجع بطاقة المصدر…",
        cardTitle: "مصدر: قائمة الطعام",
        card: "المنتج: برجر كلاسيك\nالسعر: 1.8 ر.ع\nمتوفر اليوم\nالتوصيل داخل مسقط",
      },
      en: {
        question: "Is the classic burger available today?",
        answer: "Checking the source card…",
        cardTitle: "Source: menu",
        card: "Item: Classic burger\nPrice: 1.8 OMR\nAvailable today\nDelivery inside Muscat",
      },
    },
  },
  {
    id: 3,
    key: "reply",
    theme: "dark" as const,
    anchor: "reply",
    title: { ar: "الرد من نفس المعلومة.", en: "The reply uses that same information." },
    body: {
      ar: "الجواب داخل الهاتف مثال من البطاقة، وليس رد ذكاء اصطناعي يُرسل للعميل.",
      en: "The answer inside the phone is an example from the card, not an AI reply sent to a customer.",
    },
    example: {
      ar: {
        question: "البرجر الكلاسيك متوفر اليوم؟",
        answer: "نعم، متوفر اليوم بـ 1.8 ر.ع. التوصيل داخل مسقط.",
        cardTitle: "من المصدر إلى الرد",
        card: "برجر كلاسيك · 1.8 ر.ع · متوفر اليوم · توصيل مسقط",
      },
      en: {
        question: "Is the classic burger available today?",
        answer: "Yes — available today at 1.8 OMR. Delivery inside Muscat.",
        cardTitle: "From source to reply",
        card: "Classic burger · 1.8 OMR · Available today · Muscat delivery",
      },
    },
  },
  {
    id: 4,
    key: "enquiry",
    theme: "light" as const,
    anchor: "enquiry",
    title: { ar: "نفس العميل يكمل الطلب.", en: "The same customer continues the order." },
    body: {
      ar: "تُجمع تفاصيل أوضح، وتُسجَّل بحالة انتظار. هذا مثال توضيحي، وليس تنفيذ طلب أو ربط كاشير.",
      en: "Clearer details are collected and saved as waiting. This is an illustrative example, not a live order or a POS connection.",
    },
    example: {
      ar: {
        question: "أبغى 2 برجر كلاسيك، توصيل الخوير.",
        answer: "سجّلت: 2 برجر كلاسيك إلى الخوير. بانتظار تأكيد الموظف.",
        cardTitle: "سجل الاستفسار",
        card: "الصنف: برجر كلاسيك\nالكمية: 2\nالمنطقة: الخوير\nالحالة: بانتظار تأكيد الموظف",
      },
      en: {
        question: "I want 2 classic burgers, delivery to Al Khuwair.",
        answer: "Noted: 2 classic burgers to Al Khuwair. Waiting for staff confirmation.",
        cardTitle: "Enquiry record",
        card: "Item: Classic burger\nQuantity: 2\nArea: Al Khuwair\nStatus: waiting for staff confirmation",
      },
    },
  },
  {
    id: 5,
    key: "handoff",
    theme: "dark" as const,
    anchor: "handoff",
    title: { ar: "الموظف يستلم الملخص ويكمل.", en: "Staff receive the summary and continue." },
    body: {
      ar: "نفس الحوار يصل للفريق: من العميل، ماذا طلب، وما الذي جُمع، ولماذا حُوّل.",
      en: "The same conversation reaches the team: who the customer is, what they asked, what was collected, and why it was handed over.",
    },
    example: {
      ar: {
        question: "أبغى 2 برجر كلاسيك، توصيل الخوير.",
        answer: "حوّلت الطلب للموظف مع الملخص. تكمل معه من هنا.",
        cardTitle: "ملخص للموظف",
        card: "العميل: طلب واتساب\nالطلب: 2 برجر كلاسيك · الخوير\nجُمع: 1.8 ر.ع · متوفر اليوم\nسبب التحويل: تأكيد الطلب",
      },
      en: {
        question: "I want 2 classic burgers, delivery to Al Khuwair.",
        answer: "Handed to staff with the summary. You continue with them from here.",
        cardTitle: "Summary for staff",
        card: "Customer: WhatsApp enquiry\nOrder: 2 classic burgers · Al Khuwair\nCollected: 1.8 OMR · available today\nHandoff reason: confirm the order",
      },
    },
  },
  {
    id: 6,
    key: "overview",
    theme: "light" as const,
    anchor: "overview",
    title: { ar: "لوحة صاحب النشاط لنفس القصة.", en: "The owner view of the same story." },
    body: {
      ar: "استفسار ينتظر تأكيدًا، ومسؤول محادثة، وسؤال يحتاج معلومة أوضح.",
      en: "An enquiry waiting for confirmation, a conversation owner, and a question that needs clearer information.",
    },
    example: {
      ar: {
        question: "استفسار تجهيز مناسبة",
        answer: "بانتظار متابعة الموظف.",
          cardTitle: "متابعة خدمة العملاء",
        card: "الحالات · المسؤولون · الأسئلة التي تحتاج مراجعة",
      },
      en: {
        question: "Catering enquiry",
        answer: "Waiting for staff follow-up.",
          cardTitle: "Customer-service follow-up",
        card: "Statuses · Owners · Questions needing review",
      },
    },
  },
  {
    id: 7,
    key: "setup",
    theme: "dark" as const,
    anchor: "activities",
    title: { ar: "أربع خطوات حتى التفعيل.", en: "Four steps to activation." },
    body: {
      ar: "الحساب والنشاط، ثم المعلومات، ثم الرقم والقناة، ثم المراجعة والتفعيل بمساعدتنا.",
      en: "Account and business, then information, then number and channel, then review and activation with our help.",
    },
    example: {
      ar: {
        question: "إزاي أبدأ على نشاطي؟",
        answer: "المتوفر الآن الحساب ومعلومات النشاط. الرقم والرد الآلي غير مفعّلين.",
        cardTitle: "التجهيز الحالي",
        card: "الحساب ← معلومات النشاط والملفات ← الرقم لاحقًا",
      },
      en: {
        question: "How do I get started for my business?",
        answer: "Available now: the account and business information. The number and automatic replies are not active.",
        cardTitle: "What you can prepare",
        card: "Account → Business information and files → Number later",
      },
    },
  },
  {
    id: 9,
    key: "demo",
    theme: "dark" as const,
    anchor: "demo",
    title: { ar: "جرّب مثالًا قبل العملاء.", en: "Try an example before customers arrive." },
    body: {
      ar: "اختر نشاطًا وسؤالًا. الرد مثال توضيحي داخل المحادثة، وليس استجابة ذكاء اصطناعي حقيقية.",
      en: "Pick a business type and a question. The reply is an illustrative example inside the chat, not a live AI response.",
    },
    example: {
      ar: {
        question: "عايز أجرب فيلورا.",
        answer: "اختر مثالًا مناسبًا لنشاطك، أو اطلب جلسة لتجربة معلوماتك.",
        cardTitle: "البداية: تجهيز الحساب",
        card: "القدرات والباقات تتحدد حسب احتياج نشاطك. تكامل الكاشير توسع لاحق.",
      },
      en: {
        question: "I want to try Velora.",
        answer: "Choose an example for your business, or request a session to try your information.",
        cardTitle: "Starting with your account",
        card: "Capabilities and plans are shaped around your needs. POS integration is a later extension.",
      },
    },
  },
] as const;

const plans = [
  {
    id: "support" as const,
    name: { ar: "دعم", en: "Support" },
    purpose: { ar: "اتجاه مخطط لمتابعة الاستفسارات. غير مفعّل على واتساب", en: "A planned direction for enquiries. Not active on WhatsApp" },
    features: [
      { ar: "رد من معلومات النشاط — مخطط، وغير مفعّل", en: "Replies from business information — planned, not active", status: "concept" as const },
      { ar: "استفسار واضح للفريق بدل محادثة ضائعة", en: "A clear enquiry for your team instead of a lost chat", status: "concept" as const },
      { ar: "تدخل الموظف عند الحاجة بدون ما يعيد العميل كلامه", en: "Staff can step in without the customer repeating themselves", status: "concept" as const },
      { ar: "تجهيز واختبار معاك قبل استقبال العملاء", en: "Setup and testing with you before customers arrive", status: "concept" as const },
    ],
  },
  {
    id: "expanded" as const,
    name: { ar: "المتقدم", en: "Advanced" },
    purpose: { ar: "معرفة أوسع وردود أدق لنشاط يكبر", en: "Broader knowledge and sharper replies as you grow" },
    features: [
      { ar: "كل ما في باقة الدعم", en: "Everything in Support", status: "concept" as const },
      { ar: "معرفة وملفات أوسع لأسئلة أكثر تنوعًا", en: "Wider knowledge and files for more varied questions", status: "concept" as const },
      { ar: "متابعة أوضح للاستفسارات اللي تحتاج قرار", en: "Clearer follow-up for enquiries that need a decision", status: "concept" as const },
      { ar: "بيانات المنتجات والمخزون — لاحقًا", en: "Product and stock data — later", status: "future" as const },
    ],
  },
  {
    id: "integrated" as const,
    name: { ar: "المتكامل", en: "Integrated" },
    purpose: { ar: "خدمة العملاء مربوطة بأنظمة نشاطك", en: "Customer service linked to your business systems" },
    features: [
      { ar: "كل فوائد الباقة المتقدمة", en: "Everything in the Advanced plan", status: "concept" as const },
      { ar: "ردود أقرب للواقع التشغيلي لنشاطك", en: "Replies closer to your real operations", status: "concept" as const },
      { ar: "ربط برنامج الكاشير — لاحقًا", en: "POS integration — later", status: "future" as const },
      { ar: "مزامنة البيانات وفق التكامل — لاحقًا", en: "Data sync through the integration — later", status: "future" as const },
    ],
  },
];

const ui = {
  try: { ar: "شاهد كيف يعمل", en: "See how it works" },
  start: { ar: "ابدأ تجهيز حسابك", en: "Start preparing your account" },
  tagline: {
    ar: "مساحة لتجهيز معلومات نشاطك ومتابعة الاستفسارات. الرد الآلي وربط واتساب للعملاء غير مفعّلين بعد.",
    en: "A place to prepare your business information and enquiries. Automatic replies and a customer WhatsApp connection are not active yet.",
  },
  signIn: { ar: "تسجيل الدخول", en: "Sign in" },
  openWorkspace: { ar: "افتح لوحة العمل", en: "Open your workspace" },
  continueSetup: { ar: "أكمل تجهيز نشاطك", en: "Continue your setup" },
  verifyFirst: { ar: "أكّد بريدك للمتابعة", en: "Confirm your email to continue" },
  replay: { ar: "إعادة المثال", en: "Replay example" },
  exampleNote: {
    ar: "مثال توضيحي. ليس ردًا حقيقيًا من نموذج ذكاء اصطناعي.",
    en: "Illustrative example. Not a live AI reply.",
  },
  staffInitial: { ar: "ف", en: "S" },
  scrollHint: { ar: "مرّر لتتابع القصة", en: "Scroll to follow the story" },
  lang: { ar: "EN", en: "عر" },
  langAria: { ar: "التبديل إلى الإنجليزية", en: "Switch to Arabic" },
  menu: { ar: "عرض قائمة الطعام", en: "See the menu" },
  catalogueTitle: { ar: "قائمة الطعام", en: "Menu" },
  close: { ar: "إغلاق", en: "Close" },
  confirmed: { ar: "بانتظار تأكيد الموظف", en: "Waiting for staff confirmation" },
  illustrative: { ar: "مثال توضيحي", en: "Illustrative example" },
  fromSource: { ar: "الرد يُبنى من هذه البطاقة", en: "The reply is built from this card" },
  suggested: { ar: "مقترح", en: "Suggested" },
  paused: { ar: "الموظف يتابع — الرد الآلي متوقف", en: "Staff are following up — automatic replies are paused" },
  noRepeat: {
    ar: "العميل يكمل من غير ما يعيد المحادثة.",
    en: "The customer continues without repeating the conversation.",
  },
  panelTitle: { ar: "متابعة خدمة العملاء", en: "Customer-service follow-up" },
  tabs: {
    ar: ["المحادثات", "الاستفسارات", "المعرفة"],
    en: ["Chats", "Enquiries", "Knowledge"],
  },
  rows: {
    ar: [
      ["برجر كلاسيك ×2 · الخوير", "بانتظار تأكيد الموظف", "مسؤول المحادثة: الموظف", "جُمع: 1.8 ر.ع · متوفر اليوم"],
      ["متوفر اليوم؟", "رد من معرفة النشاط", "مسؤول المحادثة: فيلورا", "نفس سؤال بداية القصة"],
      ["متى يوصل خارج مسقط؟", "تحتاج تحسين المعرفة", "مسؤول المحادثة: الفريق", "التوصيل المعرّف داخل مسقط فقط"],
    ],
    en: [
      ["Classic burger ×2 · Al Khuwair", "Waiting for staff confirmation", "Conversation owner: staff", "Collected: 1.8 OMR · available today"],
      ["Available today?", "Reply from business knowledge", "Conversation owner: Velora", "The question that opened the story"],
      ["Delivery outside Muscat?", "Needs better knowledge", "Conversation owner: team", "Delivery is defined for Muscat only"],
    ],
  },
  steps: {
    ar: [
      { title: "الحساب والنشاط", body: "تنشئ الحساب وتعرّف نوع النشاط." },
      { title: "معلومات الشركة", body: "تضيف النص والملفات ليُحفظ نصها مع الحساب." },
      { title: "الرقم والقناة", body: "ربط واتساب لاستقبال العملاء غير مفعّل بعد." },
      { title: "المراجعة والتفعيل", body: "التفعيل لاحق وبعد المراجعة، وليس تلقائيًا من الموقع." },
    ],
    en: [
      { title: "Account and business", body: "You create the account and describe the business." },
      { title: "Company information", body: "You add text and files so their text is saved with the account." },
      { title: "Number and channel", body: "A customer WhatsApp connection is not active yet." },
      { title: "Review and activation", body: "Activation comes later, after review. The site does not turn it on by itself." },
    ],
  },
  sectors: {
    restaurant: { ar: "مطاعم", en: "Restaurants" },
    retail: { ar: "متاجر", en: "Retail" },
    services: { ar: "خدمات", en: "Services" },
  },
  sectorNote: {
    restaurant: {
      ar: "مطاعم: طلب من واتساب ثم متابعة من الفريق.",
      en: "Restaurants: a WhatsApp order, then follow-up from the team.",
    },
    retail: {
      ar: "متاجر: سؤال عن منتج ثم متابعة من الفريق.",
      en: "Retail: a product question, then follow-up from the team.",
    },
    services: {
      ar: "خدمات: طلب موعد يراجعه الفريق قبل التأكيد.",
      en: "Services: a slot request the team reviews before confirmation.",
    },
  },
  price: { ar: "السعر والحصة يُحددان في العرض", en: "Price and allowance are set in the offer" },
  allowance: { ar: "السعر والحصة يُحددان في العرض", en: "Price and allowance are set in the offer" },
  choose: { ar: "مهتم بهذه الباقة", en: "Interested in this plan" },
  selected: { ar: "هذه الباقة محددة", en: "This plan is selected" },
  packagesTitle: { ar: "اختر عمق الدعم. السعر في العرض.", en: "Choose the depth of support. Price comes in the offer." },
  packagesBody: {
    ar: "ثلاث باقات للمقارنة والاهتمام فقط، وليست اشتراكًا. الرد الآلي وربط واتساب غير مفعّلين، بلا أسعار مختلقة.",
    en: "Three plans to compare and register interest, not a subscription. Automatic replies and WhatsApp are not active, and no prices are invented here.",
  },
  chat: {
    name: { ar: "لارا · مساعدة فيلورا", en: "Lara · Velora guide" },
    title: { ar: "محادثة مع مساعدة فيلورا", en: "Chat with Velora’s guide" },
    online: { ar: "متاحة الآن للمعاينة", en: "Available now in this preview" },
    openLabel: { ar: "افتح محادثة المساعدة", en: "Open help chat" },
    bubble: { ar: "محتاج مساعدة؟ اسألني بسرعة.", en: "Need a hand? Ask me quickly." },
    welcome: {
      ar: "مرحبًا! أنا لارا. اسألني عن فيلورا، واتساب، أو كيف تبدأ — والرد هنا للمعاينة فقط.",
      en: "Hi! I’m Lara. Ask about Velora, WhatsApp, or how to start — replies here are preview-only.",
    },
    placeholder: { ar: "اكتب سؤالك…", en: "Type your question…" },
    send: { ar: "إرسال", en: "Send" },
    typing: { ar: "لارا تكتب…", en: "Lara is typing…" },
    note: { ar: "معاينة واجهة فقط. لا رسالة حقيقية تُرسل.", en: "UI preview only. No real message is sent." },
    suggestions: {
      ar: ["كيف تشتغل؟", "الباقات؟", "أبدأ من وين؟"],
      en: ["How does it work?", "Plans?", "Where do I start?"],
    },
    replyHow: {
      ar: "المتوفر الآن: إنشاء حساب وتجهيز معلومات النشاط والملفات. الرد الآلي وربط واتساب للعملاء غير مفعّلين، وأمثلة الصفحة للتوضيح.",
      en: "Available now: create an account and prepare business information and files. Automatic replies and a customer WhatsApp connection are not active. Page examples are illustrative.",
    },
    replyPlans: {
      ar: "ثلاث باقات: دعم، متقدم، ومتكامل. السعر والحصة يُحددان في العرض. التكاملات مثل الكاشير لاحقة.",
      en: "Three plans: Support, Advanced and Integrated. Price and allowance are set in the offer. Integrations such as POS come later.",
    },
    replyWhatsapp: {
      ar: "واتساب هو الاتجاه المقصود، لكنه غير مربوط لاستقبال عملائك. ابدأ بتجهيز الحساب والمعلومات.",
      en: "WhatsApp is the intended channel, but it is not connected for your customers. Start by preparing the account and information.",
    },
    replyStart: {
      ar: "اضغط «ابدأ تجهيز حسابك»، أنشئ الحساب، ثم أكمل خطوات النشاط والمعلومات والرقم.",
      en: "Tap “Start preparing your account”, create the account, then finish business, information and number.",
    },
    fallback: {
      ar: "فهمتك. جرّب سؤال عن كيف تشتغل، الباقات، أو من وين تبدأ — أو مرّر لقصة الصفحة عشان تشوف المثال.",
      en: "Got it. Try asking how it works, about plans, or where to start — or scroll the page story to see the example.",
    },
  },
  faqTitle: { ar: "أسئلة قبل ما تجرب", en: "Questions before you try it" },
  aboutTitle: { ar: "من نحن", en: "About us" },
  about: {
    ar: "فيلورا خدمة تابعة لشركة TAG CITY TRAD LLC — تاج المدينة للتجارة ش م م. تجهّز فيها معلومات نشاطك وملفاته. الأمثلة توضيحية، وليست رد ذكاء اصطناعي أو ربط واتساب فعّالًا.",
    en: "Velora is a service of TAG CITY TRAD LLC — تاج المدينة للتجارة ش م م. You prepare your business information and files here. The examples are illustrative, not a live AI reply or an active WhatsApp connection.",
  },
  contactTitle: { ar: "تواصل معنا", en: "Contact us" },
  privacyTitle: { ar: "معلومات الخصوصية", en: "Privacy information" },
  privacy: {
    ar: "نحفظ لغة الصفحة على جهازك. نص التواصل يُجهَّز عندك ويُفتح في بريدك إلى velorahelperai@gmail.com، ولا يُرسل من خادمنا. بعد التسجيل نحتفظ بالاسم وبيانات النشاط والملفات المرتبطة بحسابك إلى أن تطلب حذفها.",
    en: "We keep the page language on your device. The contact note is prepared on your side and opens in your mail app to velorahelperai@gmail.com; our server does not send it. After registration we keep your name, business details and files linked to your account until you ask for them to be deleted.",
  },
  businessName: { ar: "اسم النشاط (اختياري)", en: "Business name (optional)" },
  sectorField: { ar: "نوع النشاط", en: "Business type" },
  planField: { ar: "الباقة", en: "Plan" },
  questionField: { ar: "سؤالك", en: "Your question" },
  prepare: { ar: "انسخ النص وافتح بريدك", en: "Copy the note and open your mail" },
  copy: { ar: "انسخ الطلب", en: "Copy request" },
  copied: {
    ar: "نُسخ النص. إن فُتح بريدك فهو لم يُرسل بعد — أرسله بنفسك إلى velorahelperai@gmail.com.",
    en: "Note copied. If your mail app opened, it has not been sent yet — send it yourself to velorahelperai@gmail.com.",
  },
  manual: {
    ar: "تعذّر النسخ. انسخ النص أدناه وأرسله بنفسك إلى velorahelperai@gmail.com. لم يُرسل شيء من عندنا.",
    en: "Copy failed. Copy the text below and send it yourself to velorahelperai@gmail.com. Nothing was sent by us.",
  },
  contactEmail: "velorahelperai@gmail.com",
  emailUs: { ar: "راسلنا", en: "Email us" },
  noDestination: {
    ar: "البريد أدناه. الزر ينسخ نصًا ويفتح تطبيق بريدك، ولا يرسل الرسالة عنك.",
    en: "Use the email below. The button copies a note and opens your mail app. It does not send the message for you.",
  },
  mailSubject: { ar: "طلب عرض فيلورا", en: "Velora demo request" },
  nonePlan: { ar: "بدون تحديد", en: "Not selected" },
  copyright: "© 2026 Velora",
  companyLine: {
    ar: "Velora خدمة تابعة لشركة TAG CITY TRAD LLC — تاج المدينة للتجارة ش م م، سجل تجاري 1480610، عُمان.",
    en: "Velora is a service of TAG CITY TRAD LLC — تاج المدينة للتجارة ش م م, commercial register 1480610, Oman.",
  },
  deletionLink: { ar: "حذف الحساب والبيانات", en: "Delete account and data" },
  nav: {
    how: { ar: "كيف تعمل", en: "How it works" },
    activities: { ar: "الأنشطة", en: "Business types" },
    packages: { ar: "الباقات", en: "Plans" },
    faq: { ar: "الأسئلة الشائعة", en: "FAQ" },
  },
  footer: {
    about: { ar: "من نحن", en: "About us" },
    how: { ar: "كيف تعمل", en: "How it works" },
    activities: { ar: "الأنشطة", en: "Business types" },
    packages: { ar: "الباقات", en: "Plans" },
    faq: { ar: "الأسئلة الشائعة", en: "FAQ" },
    contact: { ar: "تواصل معنا", en: "Contact us" },
    privacy: { ar: "الخصوصية", en: "Privacy" },
    terms: { ar: "شروط الاستخدام", en: "Terms of use" },
    deletion: { ar: "حذف الحساب والبيانات", en: "Delete account and data" },
  },
  faq: [
    {
      q: { ar: "هل الخدمة على واتساب أولًا؟", en: "Does it start on WhatsApp?" },
      a: {
        ar: "واتساب هو الاتجاه المقصود، لكنه غير مربوط لاستقبال عملائك بعد. المتاح الآن إنشاء حساب وتجهيز معلومات النشاط والملفات.",
        en: "WhatsApp is the intended channel, but it is not connected for your customers yet. Available now: create an account and prepare business information and files.",
      },
    },
    {
      q: { ar: "كيف تُجهَّز معرفة النشاط؟", en: "How is business knowledge prepared?" },
      a: {
        ar: "يمكنك إضافة نص وملفات مثل PDF وTXT وDOCX ليُستخرج نصها ويُحفظ لحسابك. هذا تجهيز للمعرفة، وليس ردًا آليًا للعملاء.",
        en: "You can add text and files such as PDF, TXT and DOCX so their text is extracted and saved to your account. That prepares knowledge. It does not send an automatic reply to customers.",
      },
    },
    {
      q: { ar: "متى يتدخل الموظف؟", en: "When does a person step in?" },
      a: {
        ar: "تسليم المحادثة للموظف ظاهر كمثال في الصفحة. لا يوجد تسليم حي لمحادثة عميل على واتساب بعد.",
        en: "Handing a conversation to staff is shown as an example on this page. There is no live handoff of a customer WhatsApp chat yet.",
      },
    },
    {
      q: { ar: "كيف نبدأ؟", en: "How do we start?" },
      a: {
        ar: "ابدأ بالحساب ومعلومات النشاط والملفات. ربط الرقم والتفعيل غير متاحين من الموقع الآن، والسعر يُحدد لاحقًا في العرض.",
        en: "Start with the account, business information and files. Connecting a number and activation are not available from the site now, and the price is set later in an offer.",
      },
    },
    {
      q: { ar: "ماذا عن النطاق والتكلفة؟", en: "What about scope and cost?" },
      a: {
        ar: "لا نعرض سعرًا أو حصة محادثات هنا. كلاهما يُحدَّد في العرض المتفق عليه قبل التفعيل.",
        en: "We do not show a price or a conversation allowance here. Both are set in the agreed offer before activation.",
      },
    },
  ],
  samples: {
    restaurant: [
      {
        q: { ar: "البرجر الكلاسيك متوفر اليوم؟", en: "Is the classic burger available today?" },
        a: {
          ar: "مثال توضيحي: نعم، متوفر اليوم بـ 1.8 ر.ع، والتوصيل داخل مسقط.",
          en: "Illustrative example: yes, available today at 1.8 OMR, with delivery inside Muscat.",
        },
      },
    ],
    retail: [
      {
        q: { ar: "هذا المنتج متوفر بالفرع؟", en: "Is this product available in store?" },
        a: {
          ar: "المعلومة تُراجع من معرفة المتجر، ثم يسجل الاستفسار للمتابعة. لا توفر حي هنا.",
          en: "The answer is checked against store knowledge, then the enquiry is recorded for follow-up. There is no live stock here.",
        },
      },
    ],
    services: [
      {
        q: { ar: "فيه موعد بكرة الصبح؟", en: "Is there a morning slot tomorrow?" },
        a: {
          ar: "نسجل طلب الموعد كاستفسار مبدئي ليراجعه الفريق. هذا ليس تأكيد حجز.",
          en: "We record the slot request as a preliminary enquiry for the team. This is not a confirmed booking.",
        },
      },
    ],
  },
  catalogue: {
    ar: ["سلطة", "ساندويتش", "مشروب"],
    en: ["Salad", "Sandwich", "Drink"],
  },
};

export function landingCopy(locale: Locale) {
  return {
    locale,
    try: t(locale, ui.try),
    start: t(locale, ui.start),
    tagline: t(locale, ui.tagline),
    signIn: t(locale, ui.signIn),
    openWorkspace: t(locale, ui.openWorkspace),
    continueSetup: t(locale, ui.continueSetup),
    verifyFirst: t(locale, ui.verifyFirst),
    replay: t(locale, ui.replay),
    exampleNote: t(locale, ui.exampleNote),
    staffInitial: t(locale, ui.staffInitial),
    scrollHint: t(locale, ui.scrollHint),
    lang: t(locale, ui.lang),
    langAria: t(locale, ui.langAria),
    menu: t(locale, ui.menu),
    catalogueTitle: t(locale, ui.catalogueTitle),
    close: t(locale, ui.close),
    confirmed: t(locale, ui.confirmed),
    illustrative: t(locale, ui.illustrative),
    fromSource: t(locale, ui.fromSource),
    suggested: t(locale, ui.suggested),
    paused: t(locale, ui.paused),
    noRepeat: t(locale, ui.noRepeat),
    panelTitle: t(locale, ui.panelTitle),
    tabs: ui.tabs[locale],
    rows: ui.rows[locale],
    steps: ui.steps[locale],
    sectors: (Object.keys(ui.sectors) as SectorId[]).map((id) => ({
      id,
      label: t(locale, ui.sectors[id]),
      note: t(locale, ui.sectorNote[id]),
    })),
    price: t(locale, ui.price),
    allowance: t(locale, ui.allowance),
    choose: t(locale, ui.choose),
    selected: t(locale, ui.selected),
    packagesTitle: t(locale, ui.packagesTitle),
    packagesBody: t(locale, ui.packagesBody),
    chat: {
      name: t(locale, ui.chat.name),
      title: t(locale, ui.chat.title),
      online: t(locale, ui.chat.online),
      openLabel: t(locale, ui.chat.openLabel),
      bubble: t(locale, ui.chat.bubble),
      welcome: t(locale, ui.chat.welcome),
      placeholder: t(locale, ui.chat.placeholder),
      send: t(locale, ui.chat.send),
      typing: t(locale, ui.chat.typing),
      note: t(locale, ui.chat.note),
      suggestions: ui.chat.suggestions[locale],
      replyHow: t(locale, ui.chat.replyHow),
      replyPlans: t(locale, ui.chat.replyPlans),
      replyWhatsapp: t(locale, ui.chat.replyWhatsapp),
      replyStart: t(locale, ui.chat.replyStart),
      fallback: t(locale, ui.chat.fallback),
    },
    plans: plans.map((plan) => ({
      id: plan.id,
      name: t(locale, plan.name),
      purpose: t(locale, plan.purpose),
      features: plan.features.map((feature) => ({
        text: t(locale, feature),
        status: feature.status,
      })),
    })),
    faqTitle: t(locale, ui.faqTitle),
    faq: ui.faq.map((item) => ({ q: t(locale, item.q), a: t(locale, item.a) })),
    aboutTitle: t(locale, ui.aboutTitle),
    about: t(locale, ui.about),
    contactTitle: t(locale, ui.contactTitle),
    privacyTitle: t(locale, ui.privacyTitle),
    privacy: t(locale, ui.privacy),
    businessName: t(locale, ui.businessName),
    sectorField: t(locale, ui.sectorField),
    planField: t(locale, ui.planField),
    questionField: t(locale, ui.questionField),
    prepare: t(locale, ui.prepare),
    copy: t(locale, ui.copy),
    copied: t(locale, ui.copied),
    manual: t(locale, ui.manual),
    contactEmail: ui.contactEmail,
    emailUs: t(locale, ui.emailUs),
    noDestination: t(locale, ui.noDestination),
    mailSubject: t(locale, ui.mailSubject),
    nonePlan: t(locale, ui.nonePlan),
    copyright: ui.copyright,
    companyLine: t(locale, ui.companyLine),
    deletionLink: t(locale, ui.deletionLink),
    nav: {
      how: t(locale, ui.nav.how),
      activities: t(locale, ui.nav.activities),
      packages: t(locale, ui.nav.packages),
      faq: t(locale, ui.nav.faq),
    },
    footer: {
      about: t(locale, ui.footer.about),
      how: t(locale, ui.footer.how),
      activities: t(locale, ui.footer.activities),
      packages: t(locale, ui.footer.packages),
      faq: t(locale, ui.footer.faq),
      contact: t(locale, ui.footer.contact),
      privacy: t(locale, ui.footer.privacy),
      terms: t(locale, ui.footer.terms),
      deletion: t(locale, ui.footer.deletion),
    },
    scenes: scenes.map((scene) => ({
      ...scene,
      title: t(locale, scene.title),
      body: t(locale, scene.body),
      example: scene.example[locale],
      chips: "chips" in scene ? scene.chips[locale] : [],
    })),
    samples: ui.samples,
    catalogue: ui.catalogue[locale],
    sampleFor(sector: SectorId) {
      const item = ui.samples[sector][0];
      return { q: t(locale, item.q), a: t(locale, item.a) };
    },
  };
}

export type LandingCopy = ReturnType<typeof landingCopy>;

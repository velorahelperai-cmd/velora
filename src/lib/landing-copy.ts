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
      ar: "كل رسالة بلا رد سريع… عميل قد يفكر يشتري من غيرك.",
      en: "Every unanswered message is a customer who may buy elsewhere.",
    },
    body: {
      ar: "الأسئلة تتكرر، والدوام محدود، والفريق مشغول. فيلورا يرد من معلومات نشاطك، يحفظ الاستفسار، ويخلي متابعتك واضحة قبل ما يضيع العميل.",
      en: "Questions repeat, hours are limited, and your team is busy. Velora replies from your business information, keeps the enquiry, and makes follow-up clear before the customer slips away.",
    },
    example: {
      ar: {
        question: "عايز أطلب 2 برجر",
        answer: "السؤال ينتظر إجابة…",
        cardTitle: "في انتظار الرد",
        card: "الطلب · التأهيل · إتمام الصفقة",
      },
      en: {
        question: "I want to order 2 burgers",
        answer: "Waiting for a reply…",
        cardTitle: "Waiting for a reply",
        card: "Order · Qualify · Close the deal",
      },
    },
    chips: {
      ar: ["طلب جديد؟", "متابعة؟", "حجز؟"],
      en: ["New order?", "Follow-up?", "Booking?"],
    },
  },
  {
    id: 2,
    key: "knowledge",
    theme: "light" as const,
    anchor: "how",
    title: { ar: "معلومات نشاطك هي أساس الرد.", en: "Your business information is the basis of every reply." },
    body: {
      ar: "أضف معلومات نشاطك وملفاتك، وراجع المعرفة واختبر الردود قبل التفعيل.",
      en: "Add your business information and files, review the knowledge and test replies before activation.",
    },
    example: {
      ar: {
        question: "عايز أطلب 2 برجر",
        answer: "نراجع معلومات النشاط.",
        cardTitle: "مصدر الإجابة — للفريق",
        card: "المنيو والأسعار: البرجر متاح للطلب.",
      },
      en: {
        question: "I want to order 2 burgers",
        answer: "Checking the business information.",
        cardTitle: "Answer source — for staff",
        card: "Menu and prices: burgers are available to order.",
      },
    },
  },
  {
    id: 3,
    key: "reply",
    theme: "dark" as const,
    anchor: "reply",
    title: { ar: "رد واضح. من معرفة شركتك.", en: "Clear replies. Grounded in your business." },
    body: {
      ar: "رد على الأسئلة المتكررة من معرفة نشاطك، ثم خطوة مفيدة مثل رابط المنيو أو الكتالوج.",
      en: "Answer recurring questions from your business knowledge, then offer a useful next step such as a menu or catalogue link.",
    },
    example: {
      ar: {
        question: "عايز أطلب 2 برجر",
        answer: "تمام. برجرين. تفضّل الحجم والإضافات؟",
        cardTitle: "إجابة من المعرفة",
        card: "الطلب مفهوم، والخطوة التالية واضحة للعميل.",
      },
      en: {
        question: "I want to order 2 burgers",
        answer: "Got it — two burgers. Which size and extras would you like?",
        cardTitle: "Reply from business knowledge",
        card: "The request is understood, with a clear next step for the customer.",
      },
    },
  },
  {
    id: 4,
    key: "enquiry",
    theme: "light" as const,
    anchor: "enquiry",
    title: { ar: "تفاصيل واضحة، ومتابعة لها مسؤول.", en: "Clear details, and a follow-up with an owner." },
    body: {
      ar: "اجمع تفاصيل الاستفسار، أكدها مع العميل، وخلي المتابعة واضحة للفريق.",
      en: "Collect enquiry details, confirm them with the customer and make the follow-up clear to your team.",
    },
    example: {
      ar: {
        question: "محتاج أتواصل بخصوص تجهيز مناسبة.",
        answer: "نراجع التفاصيل معك قبل تسجيل الاستفسار للفريق.",
        cardTitle: "استفسار مبدئي",
        card: "البيانات مؤكدة · مسؤول متابعة · حالة واضحة",
      },
      en: {
        question: "I need to discuss catering for an occasion.",
        answer: "We will review the details with you before recording the enquiry for the team.",
        cardTitle: "Preliminary enquiry",
        card: "Confirmed details · Follow-up owner · Clear status",
      },
    },
  },
  {
    id: 5,
    key: "handoff",
    theme: "dark" as const,
    anchor: "handoff",
    title: { ar: "فريقك يستلم التفاصيل. وعميلك يكمل دون تكرار.", en: "Your team receives the details. Your customer continues without repeating." },
    body: {
      ar: "الموظف يستلم السؤال والملخص، والرد الآلي يتوقف؛ العميل يكمل من غير ما يعيد كلامه.",
      en: "A team member receives the question and summary while automatic replies pause. The customer continues without repeating the conversation.",
    },
    example: {
      ar: {
        question: "محتاج أتكلم مع حد من الفريق.",
        answer: "تم تحويل الاستفسار للفريق مع تفاصيل المحادثة.",
        cardTitle: "المسؤول: الموظف",
        card: "الرد التلقائي متوقف · الملخص والسجل متاحان",
      },
      en: {
        question: "I need to speak with someone on the team.",
        answer: "The enquiry has been handed to the team with the conversation details.",
        cardTitle: "Owner: staff member",
        card: "Automatic replies paused · Summary and history available",
      },
    },
  },
  {
    id: 6,
    key: "overview",
    theme: "light" as const,
    anchor: "overview",
    title: { ar: "اعرف من يحتاج ردًا، وما يحتاج متابعة.", en: "Know who needs a reply, and what needs follow-up." },
    body: {
      ar: "تابع المحادثات والمسؤولين والحالات، واكتشف الأسئلة اللي محتاجة معلومات أفضل.",
      en: "Track conversations, owners and statuses, and identify questions that need better information.",
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
    title: { ar: "جهّز معلوماتك. ونحن نساعدك في التفعيل.", en: "Prepare your information. We help you activate." },
    body: {
      ar: "نجهز الحساب والمعرفة والرقم معك، ونختبر البداية حسب احتياج نشاطك.",
      en: "We prepare the account, knowledge and number with you, and test the start around your business needs.",
    },
    example: {
      ar: {
        question: "إزاي أبدأ على نشاطي؟",
        answer: "نجهز الحساب والمعرفة والرقم، ونختبر الردود معك قبل التفعيل.",
        cardTitle: "التجهيز بمساعدتنا",
        card: "الحساب ← المعرفة ← الرقم والاختبار ← مراجعة التفعيل",
      },
      en: {
        question: "How do I get started for my business?",
        answer: "We prepare the account, knowledge and number, and test replies with you before activation.",
        cardTitle: "Assisted setup",
        card: "Account → Knowledge → Number and testing → Activation review",
      },
    },
  },
  {
    id: 9,
    key: "demo",
    theme: "dark" as const,
    anchor: "demo",
    title: { ar: "اختبر الردود قبل استقبال عملائك.", en: "Test the replies before your customers arrive." },
    body: {
      ar: "جرّب محادثة مناسبة لنشاطك، ثم ابدأ تجهيز معلوماتك عندما تكون جاهزًا.",
      en: "Try a conversation that fits your business, then start preparing your information when you are ready.",
    },
    example: {
      ar: {
        question: "عايز أجرب فيلورا.",
        answer: "اختر مثالًا مناسبًا لنشاطك، أو اطلب جلسة لتجربة معلوماتك.",
        cardTitle: "البداية: واتساب",
        card: "القدرات والباقات تتحدد حسب احتياج نشاطك. تكامل الكاشير توسع لاحق.",
      },
      en: {
        question: "I want to try Velora.",
        answer: "Choose an example for your business, or request a session to try your information.",
        cardTitle: "Starting with WhatsApp",
        card: "Capabilities and plans are shaped around your needs. POS integration is a later extension.",
      },
    },
  },
] as const;

const plans = [
  {
    id: "support" as const,
    name: { ar: "الأساسي", en: "Basic" },
    purpose: { ar: "توقف ضياع الاستفسارات اليومية على واتساب", en: "Stop losing everyday WhatsApp enquiries" },
    features: [
      { ar: "رد فوري من معلومات نشاطك — حتى بعد الدوام", en: "Instant replies from your business info — even after hours", status: "concept" as const },
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
      { ar: "كل فوائد الباقة الأساسية", en: "Everything in the Basic plan", status: "concept" as const },
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
  try: { ar: "شاهد مثالًا", en: "See an example" },
  start: { ar: "ابدأ تجهيز نشاطك", en: "Start preparing your business" },
  tagline: { ar: "فيلورا، مساعد خدمة العملاء لنشاطك.", en: "Velora, the customer-service assistant for your business." },
  signIn: { ar: "تسجيل الدخول", en: "Sign in" },
  openWorkspace: { ar: "افتح لوحة العمل", en: "Open your workspace" },
  continueSetup: { ar: "أكمل تجهيز نشاطك", en: "Continue your setup" },
  verifyFirst: { ar: "أكّد بريدك للمتابعة", en: "Confirm your email to continue" },
  replay: { ar: "إعادة المثال", en: "Replay example" },
  exampleNote: { ar: "بيانات الخدمة مثال.", en: "Service data is an example." },
  staffInitial: { ar: "ف", en: "S" },
  scrollHint: { ar: "مرّر لتتابع القصة", en: "Scroll to follow the story" },
  lang: { ar: "EN", en: "عر" },
  langAria: { ar: "التبديل إلى الإنجليزية", en: "Switch to Arabic" },
  menu: { ar: "عرض قائمة الطعام", en: "See the menu" },
  catalogueTitle: { ar: "قائمة الطعام", en: "Menu" },
  close: { ar: "إغلاق", en: "Close" },
  confirmed: { ar: "بيانات مؤكدة مع العميل", en: "Details confirmed with the customer" },
  paused: { ar: "الرد التلقائي متوقف", en: "Automatic replies paused" },
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
      ["طلب 2 برجر", "بانتظار الاعتماد", "المسؤول: فريق الخدمة"],
      ["طلب جديد من واتساب", "رد من المعرفة", ""],
      ["سؤال يحتاج معلومة جديدة", "للمراجعة", ""],
    ],
    en: [
      ["Order: 2 burgers", "Waiting for approval", "Owner: service team"],
      ["New WhatsApp order", "Reply from knowledge", ""],
      ["Question needs new information", "For review", ""],
    ],
  },
  steps: {
    ar: ["الحساب والفريق", "معرفة الشركة", "الرقم والاختبارات", "مراجعة التفعيل"],
    en: ["Account and team", "Business knowledge", "Number and testing", "Activation review"],
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
  price: { ar: "السعر: قيد التحديد", en: "Price: to be confirmed" },
  allowance: { ar: "حصة المحادثات: قيد التحديد", en: "Conversation allowance: to be confirmed" },
  choose: { ar: "مهتم بهذه الباقة", en: "Interested in this plan" },
  selected: { ar: "هذه الباقة محددة", en: "This plan is selected" },
  packagesTitle: { ar: "اشترك عشان ما يضيع عميل بسبب تأخر الرد.", en: "Subscribe so a slow reply does not cost you a customer." },
  packagesBody: {
    ar: "باقات واضحة: رد أسرع، استفسارات منظمة، ومتابعة للفريق. الأسعار والحصص تتحدد بعد ضبط العرض.",
    en: "Clear plans: faster replies, organised enquiries, and team follow-up. Prices and allowances are confirmed with the offer.",
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
      ar: "فيلورا مساعد على واتساب يرد من معلومات نشاطك، وينظم الاستفسارات، ويخلي فريقك يتدخل عند الحاجة.",
      en: "Velora is a WhatsApp assistant that replies from your business information, organises enquiries, and lets your team step in when needed.",
    },
    replyPlans: {
      ar: "عندنا ثلاث باقات: أساسي ومتقدم ومتكامل. الأسعار والحصص تتحدد بعد ضبط العرض — تقدر تختار باقة من قسم الباقات.",
      en: "There are three plans: Basic, Advanced and Integrated. Prices and allowances are confirmed with the offer — pick a plan in the Plans section.",
    },
    replyWhatsapp: {
      ar: "نبدأ على واتساب. تجهّز معلومات نشاطك معنا، وتختبر الردود قبل التفعيل.",
      en: "We start on WhatsApp. Prepare your business information with us and test replies before activation.",
    },
    replyStart: {
      ar: "اضغط «ابدأ تجهيز نشاطك» من أعلى الصفحة، وأنشئ حسابك ثم أكمل خطوات التجهيز.",
      en: "Tap “Start preparing your business” at the top, create your account, then finish the setup steps.",
    },
    fallback: {
      ar: "فهمتك. جرّب سؤال عن كيف تشتغل، الباقات، أو من وين تبدأ — أو مرّر لقصة الصفحة عشان تشوف المثال.",
      en: "Got it. Try asking how it works, about plans, or where to start — or scroll the page story to see the example.",
    },
  },
  faqTitle: { ar: "أسئلة قبل ما تجرب", en: "Questions before you try it" },
  aboutTitle: { ar: "من نحن", en: "About us" },
  about: {
    ar: "فيلورا مساعد لخدمة العملاء على واتساب، يستند إلى معلومات النشاط وينظم الاستفسارات مع إمكانية تدخل الفريق. نبدأ بتجهيز الحساب والمعرفة والرقم معك.",
    en: "Velora is a WhatsApp customer-service assistant grounded in business information, helping organise enquiries with your team able to step in. We help prepare the account, knowledge and number with you.",
  },
  contactTitle: { ar: "تواصل معنا", en: "Contact us" },
  privacyTitle: { ar: "معلومات الخصوصية", en: "Privacy information" },
  privacy: {
    ar: "نحفظ لغة العرض في ملف تعريف ارتباط باسم velora_locale على جهازك. تجهيز طلب العرض يتم في المتصفح؛ يمكنك نسخه أو فتحه في بريدك إلى velorahelper@gmail.com. سياسة الاحتفاظ التفصيلية تُحدَّد قبل الإطلاق.",
    en: "We store the display language in a cookie named velora_locale on your device. A demo request is prepared in the browser; you can copy it or open it in your mail app to velorahelper@gmail.com. A detailed retention policy will be set before launch.",
  },
  businessName: { ar: "اسم النشاط (اختياري)", en: "Business name (optional)" },
  sectorField: { ar: "نوع النشاط", en: "Business type" },
  planField: { ar: "الباقة", en: "Plan" },
  questionField: { ar: "سؤالك", en: "Your question" },
  prepare: { ar: "جهّز طلب عرض", en: "Prepare a demo request" },
  copy: { ar: "انسخ الطلب", en: "Copy request" },
  copied: {
    ar: "تم نسخ الطلب. إن فُتح بريدك، أرسله إلى velorahelper@gmail.com — لم يُرسل من خادمنا.",
    en: "Request copied. If your mail app opened, send it to velorahelper@gmail.com — nothing was sent from our server.",
  },
  manual: {
    ar: "تعذّر النسخ التلقائي. انسخ النص التالي يدويًا وأرسله إلى velorahelper@gmail.com. لم يُرسل الطلب من خادمنا.",
    en: "Automatic copy failed. Copy the text below manually and send it to velorahelper@gmail.com. The request was not sent from our server.",
  },
  contactEmail: "velorahelper@gmail.com",
  emailUs: { ar: "راسلنا", en: "Email us" },
  noDestination: {
    ar: "تواصل معنا على البريد التالي. تجهيز الطلب يتم في متصفحك؛ الإرسال عبر بريدك أنت.",
    en: "Reach us at the email below. The request is prepared in your browser; you send it from your own mail app.",
  },
  mailSubject: { ar: "طلب عرض فيلورا", en: "Velora demo request" },
  nonePlan: { ar: "بدون تحديد", en: "Not selected" },
  copyright: "© 2026 Velora",
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
  },
  faq: [
    {
      q: { ar: "هل الخدمة على واتساب أولًا؟", en: "Does it start on WhatsApp?" },
      a: {
        ar: "نعم. نبدأ على واتساب.",
        en: "Yes. We start on WhatsApp.",
      },
    },
    {
      q: { ar: "كيف تُجهَّز معرفة النشاط؟", en: "How is business knowledge prepared?" },
      a: {
        ar: "تضيف المعلومات والملفات، تراجعها، ثم تختبر الردود قبل التفعيل. المصدر يظهر للفريق خارج محادثة العميل.",
        en: "You add information and files, review them, then test replies before activation. The source stays visible to staff outside the customer chat.",
      },
    },
    {
      q: { ar: "متى يتدخل الموظف؟", en: "When does a person step in?" },
      a: {
        ar: "عند الحاجة يستلم الموظف السؤال والملخص، ويتوقف الرد التلقائي. العميل لا يعيد المحادثة.",
        en: "When needed, a team member receives the question and summary and automatic replies pause. The customer does not repeat the conversation.",
      },
    },
    {
      q: { ar: "كيف نبدأ؟", en: "How do we start?" },
      a: {
        ar: "نجهز الحساب والفريق، ثم المعرفة، ثم الرقم والاختبارات، ثم مراجعة التفعيل. لا وعد بتفعيل فوري.",
        en: "We prepare the account and team, then knowledge, then the number and tests, then an activation review. There is no promise of instant activation.",
      },
    },
    {
      q: { ar: "ماذا عن النطاق والتكلفة؟", en: "What about scope and cost?" },
      a: {
        ar: "الأسعار وحصص المحادثات ورسوم المنصة أو الذكاء قيد التحديد ضمن العرض المتفق عليه. لا حاسبة أسعار هنا.",
        en: "Prices, conversation allowances and platform or AI charges are to be confirmed in the agreed offer. There is no price calculator here.",
      },
    },
  ],
  samples: {
    restaurant: [
      {
        q: { ar: "عايز أطلب 2 برجر", en: "I want to order 2 burgers" },
        a: {
          ar: "تمام. برجرين. تفضّل الحجم والإضافات؟",
          en: "Got it — two burgers. Which size and extras would you like?",
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

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
      ar: "كل محادثة فرصة. خلّي متابعتها أوضح.",
      en: "Every conversation is an opportunity. Make the next step clear.",
    },
    body: {
      ar: "الأسئلة تتكرر، والفريق ينشغل، وبعض المتابعات تتأخر. نطوّر فيلورا لتساعد نشاطك على تنظيم معلوماته ومحادثاته، وتحديد من يحتاج ردًا وما الخطوة التالية. القصة توضح المسار المستهدف؛ الردود الآلية المعروضة أمثلة.",
      en: "Questions repeat, teams get busy, and some follow-ups are delayed. We’re building Velora to help organise your business information and conversations, identify who needs a reply, and make the next step clear. The story illustrates the intended workflow; automated replies shown are examples.",
    },
    example: {
      ar: {
        question: "البرجر الكلاسيك متوفر اليوم؟",
        answer: "بانتظار الرد",
        cardTitle: "أسئلة صاحب النشاط",
        card: "مين مستني رد؟\nأي استفسار محتاج متابعة؟\nإيه الخطوة اللي تقرّب العميل؟",
      },
      en: {
        question: "Is the classic burger available today?",
        answer: "Waiting for a reply",
        cardTitle: "Owner questions",
        card: "Who is still waiting for a reply?\nWhich enquiry needs follow-up?\nWhat’s the next step?",
      },
    },
    chips: {
  "ar": [
    "مين مستني رد؟",
    "أي استفسار محتاج متابعة؟",
    "إيه الخطوة الجاية؟",
    "متاح النهارده؟",
    "التوصيل للخوير؟",
    "ممكن أعرف التفاصيل؟",
    "حد يتابع طلبي؟"
  ],
  "en": [
    "Who is still waiting for a reply?",
    "Which enquiry needs follow-up?",
    "What’s the next step?",
    "Available today?",
    "Delivery to Al Khuwair?",
    "Can I get the details?",
    "Can someone follow up?"
  ]
},
  },
  {
    id: 2,
    key: "knowledge",
    theme: "light" as const,
    anchor: "how",
    title: {
      ar: "الرد الجيد يبدأ بمعلومات واضحة.",
      en: "Good replies start with clear information.",
    },
    body: {
      ar: "جهّز منتجاتك وخدماتك وسياساتك في مكان واحد. هذه نقطة البداية لرد يستند إلى نشاطك وخطوة تالية مفهومة.",
      en: "Bring your products, services, and policies together. They provide the foundation for a relevant reply and a clear next step.",
    },
    example: {
      ar: {
        question: "البرجر الكلاسيك متوفر اليوم؟",
        answer: "نراجع بطاقة المصدر...",
        cardTitle: "مصدر: قائمة الطعام — مثال",
        card: "المنتج: برجر كلاسيك\nمتوفر في هذا المثال\nالتوصيل داخل مسقط",
      },
      en: {
        question: "Is the classic burger available today?",
        answer: "Checking the source card...",
        cardTitle: "Source: menu — example",
        card: "Item: Classic burger\nAvailable in this example\nDelivery within Muscat",
      },
    },
  },
  {
    id: 3,
    key: "reply",
    theme: "dark" as const,
    anchor: "reply",
    title: {
      ar: "جواب يفيد العميل ويقرّب الخطوة التالية.",
      en: "An answer that helps the customer move forward.",
    },
    body: {
      ar: "في المثال، يحصل العميل على معلومة التوفر والتوصيل، ثم يعرف كيف يكمل استفساره.",
      en: "In this example, the customer learns about availability and delivery, then knows how to continue.",
    },
    example: {
      ar: {
        question: "البرجر الكلاسيك متوفر اليوم؟",
        answer: "نعم، متوفر. تحب كام برجر؟ والتوصيل لفين؟",
        cardTitle: "من المعلومة إلى الرد",
        card: "برجر كلاسيك · متوفر في المثال · توصيل مسقط",
      },
      en: {
        question: "Is the classic burger available today?",
        answer: "Available. How many burgers? Delivery area?",
        cardTitle: "From information to reply",
        card: "Classic burger · Available in this example · Muscat delivery",
      },
    },
  },
  {
    id: 4,
    key: "enquiry",
    theme: "light" as const,
    anchor: "enquiry",
    title: {
      ar: "اهتمام العميل يستحق متابعة.",
      en: "Customer interest deserves follow-up.",
    },
    body: {
      ar: "تفاصيل ما يريده العميل، وما ينتظر التأكيد، تجعل المتابعة أوضح. المثال يعرض استفسارًا يحتاج مراجعة الفريق قبل اعتماد الطلب.",
      en: "Capture what the customer wants and what still needs confirmation. This example shows an enquiry awaiting the team’s review.",
    },
    example: {
      ar: {
        question: "البرجر الكلاسيك متوفر اليوم؟\n\nعايز ٢ برجر، والتوصيل للخوير.",
        answer: "نعم، متوفر. تحب كام برجر؟ والتوصيل لفين؟\n\n٢ برجر للخوير. أي ملاحظات على الطلب؟",
        cardTitle: "سجل الاستفسار",
        card: "الصنف: برجر كلاسيك\nالكمية: 2\nالمنطقة: الخوير\nالحالة: بانتظار تأكيد الفريق",
      },
      en: {
        question: "Is the classic burger available today?\n\nTwo classic burgers to Al Khuwair.",
        answer: "Available. How many burgers? Delivery area?\n\nTwo burgers to Al Khuwair. Any notes?",
        cardTitle: "Enquiry record",
        card: "Item: Classic burger\nQuantity: 2\nArea: Al Khuwair\nStatus: Awaiting team confirmation",
      },
    },
  },
  {
    id: 5,
    key: "handoff",
    theme: "dark" as const,
    anchor: "handoff",
    title: {
      ar: "فريقك يكمل من حيث وصلت المحادثة.",
      en: "Your team picks up where the conversation left off.",
    },
    body: {
      ar: "يعرض المثال سؤال العميل والتفاصيل والخطوة المطلوبة، حتى يبدأ الموظف المتابعة بسياق واضح.",
      en: "The example brings together the question, details, and next action so staff can follow up with context.",
    },
    example: {
      ar: {
        question: "البرجر الكلاسيك متوفر اليوم؟\n\nعايز ٢ برجر، والتوصيل للخوير.\n\nلا، شكرًا. هذا كل شيء.",
        answer: "نعم، متوفر. تحب كام برجر؟ والتوصيل لفين؟\n\n٢ برجر للخوير. أي ملاحظات على الطلب؟\n\n٢ برجر كلاسيك للخوير. بانتظار تأكيد الفريق.",
        cardTitle: "ملخص للفريق",
        card: "الاهتمام: ٢ برجر كلاسيك للخوير\nالمطلوب: مراجعة التفاصيل وتأكيد الطلب",
      },
      en: {
        question: "Is the classic burger available today?\n\nTwo classic burgers to Al Khuwair.\n\nNo notes, thank you.",
        answer: "Available. How many burgers? Delivery area?\n\nTwo burgers to Al Khuwair. Any notes?\n\nTwo classic burgers to Al Khuwair. Pending team confirmation.",
        cardTitle: "Summary for the team",
        card: "Interest: two classic burgers to Al Khuwair\nAction: review details and confirm the order",
      },
    },
  },
  {
    id: 6,
    key: "overview",
    theme: "light" as const,
    anchor: "overview",
    title: {
      ar: "اعرف ما يحتاج إجراءً، ثم تابع.",
      en: "See what needs action. Then follow up.",
    },
    body: {
      ar: "يعرض المثال استفسارًا ينتظر التأكيد، وعميلًا يحتاج متابعة، وسؤالًا يحتاج معلومة أوضح؛ لتكون الخطوة التالية مفهومة للفريق.",
      en: "The example shows an enquiry awaiting confirmation, a customer needing follow-up, and a question needing clearer information.",
    },
    example: {
      ar: {
        question: "استفسار تجهيز مناسبة",
        answer: "بانتظار متابعة الفريق.",
        cardTitle: "متابعة خدمة العملاء",
        card: "الحالات · المسؤولون · الأسئلة التي تحتاج مراجعة",
      },
      en: {
        question: "Catering enquiry",
        answer: "Waiting for team follow-up.",
        cardTitle: "Customer-service follow-up",
        card: "Statuses · Owners · Questions needing review",
      },
    },
  },
  {
    id: 7,
    key: "setup",
    theme: "dark" as const,
    anchor: "setup",
    title: {
      ar: "ابدأ بمعلومات نشاطك.",
      en: "Start with your business information.",
    },
    body: {
      ar: "أنشئ الحساب وجهّز المعلومات، ثم راجع معنا نطاق التجربة وما يلزم للربط والتفعيل.",
      en: "Create your account and prepare your information, then review the trial scope and activation requirements with us.",
    },
    example: {
      ar: {
        question: "إزاي أبدأ على نشاطي؟",
        answer: "ابدأ بالحساب ومعلومات النشاط. الربط والرد الآلي يُراجعان لاحقًا.",
        cardTitle: "التجهيز الحالي",
        card: "الحساب ← معلومات النشاط والملفات ← مراجعة الربط والتجربة",
      },
      en: {
        question: "How do I get started for my business?",
        answer: "Start with the account and business information. Connection and automatic replies are reviewed later.",
        cardTitle: "What you can prepare",
        card: "Account → Business information and files → Review connection and trial",
      },
    },
  },
  {
    id: 9,
    key: "demo",
    theme: "dark" as const,
    anchor: "demo",
    title: {
      ar: "شاهد الخطوة التالية في نشاطك.",
      en: "See the next step for your business.",
    },
    body: {
      ar: "اختر نشاطًا وتابع قصة واحدة: سؤال → معلومة → تفاصيل اهتمام → مراجعة الفريق. الردود هنا تمثّل المسار المستهدف.",
      en: "Pick a business type and follow one story: question → information → interest details → team review. The replies here represent the intended path.",
    },
    example: {
      ar: {
        question: "عايز أجرب فيلورا.",
        answer: "اختر مثالًا مناسبًا لنشاطك، أو راسلنا لنناقش متابعتك.",
        cardTitle: "البداية: تجهيز الحساب",
        card: "مستويات الدعم تُناقش حسب احتياج نشاطك. التكاملات توسع لاحق.",
      },
      en: {
        question: "I want to try Velora.",
        answer: "Choose an example for your business, or contact us to discuss follow-up.",
        cardTitle: "Starting with your account",
        card: "Support levels are discussed around your needs. Integrations come later.",
      },
    },
  },
] as const;

const plans = [
  {
    id: "support" as const,
    name: { ar: "دعم", en: "Support" },
    purpose: { ar: "نقطة البداية ضمن مستويات فيلورا المقترحة.", en: "The starting point in Velora’s proposed tier structure." },
    features: [
  {
    "ar": "مستوى واحد لكل شركة",
    "en": "One tier per company",
    "status": "concept"
  },
  {
    "ar": "تفاصيل القدرات والحدود قيد الاعتماد",
    "en": "Capabilities and limits being finalised",
    "status": "concept"
  },
  {
    "ar": "الأسعار والمدة تُوضح قبل الاشتراك",
    "en": "Price and term clarified before subscribing",
    "status": "concept"
  }
],
  },
  {
    id: "expanded" as const,
    name: { ar: "المتقدم", en: "Advanced" },
    purpose: { ar: "خيار أعلى ضمن المنتج نفسه.", en: "A higher tier of the same product." },
    features: [
  {
    "ar": "مستوى واحد لكل شركة",
    "en": "One tier per company",
    "status": "concept"
  },
  {
    "ar": "تفاصيل القدرات والحدود قيد الاعتماد",
    "en": "Capabilities and limits being finalised",
    "status": "concept"
  },
  {
    "ar": "الأسعار والمدة تُوضح قبل الاشتراك",
    "en": "Price and term clarified before subscribing",
    "status": "concept"
  }
],
  },
  {
    id: "integrated" as const,
    name: { ar: "المتكامل", en: "Integrated" },
    purpose: { ar: "أعلى مستوى ضمن التصور الحالي.", en: "The highest tier in the current proposed structure." },
    features: [
  {
    "ar": "مستوى واحد لكل شركة",
    "en": "One tier per company",
    "status": "concept"
  },
  {
    "ar": "تفاصيل القدرات والحدود قيد الاعتماد",
    "en": "Capabilities and limits being finalised",
    "status": "concept"
  },
  {
    "ar": "الأسعار والمدة تُوضح قبل الاشتراك",
    "en": "Price and term clarified before subscribing",
    "status": "concept"
  }
],
  },
];

const ui = {
  try: { ar: "شاهد مسار المحادثة", en: "See the conversation journey" },
  start: { ar: "ابدأ تجهيز حسابك", en: "Prepare your account" },
  tagline: {
    ar: "تنظيم الرد والمتابعة — والخطوة التالية أوضح.",
    en: "Organised replies and follow-up — with a clearer next step.",
  },
  signIn: { ar: "تسجيل الدخول", en: "Sign in" },
  openWorkspace: { ar: "افتح مساحة العمل", en: "Open your workspace" },
  continueSetup: { ar: "أكمل تجهيز نشاطك", en: "Continue your setup" },
  verifyFirst: { ar: "أكّد بريدك للمتابعة", en: "Confirm your email to continue" },
  replay: { ar: "إعادة المثال", en: "Replay example" },
  exampleNote: {
    ar: "عرض توضيحي ببيانات افتراضية؛ لا يرسل رسائل أو ينفّذ طلبات.",
    en: "Illustrative demo with fictional data. No messages or orders are sent.",
  },
  demoContact: {
    ar: "ناقش احتياج نشاطك",
    en: "Discuss your business needs",
  },
  staffInitial: { ar: "ف", en: "S" },
  scrollHint: { ar: "مرّر لتتابع القصة", en: "Scroll to follow the story" },
  lang: { ar: "EN", en: "عر" },
  langAria: { ar: "التبديل إلى الإنجليزية", en: "Switch to Arabic" },
  menu: { ar: "عرض قائمة الطعام", en: "See the menu" },
  catalogueTitle: { ar: "قائمة الطعام", en: "Menu" },
  close: { ar: "إغلاق", en: "Close" },
  confirmed: { ar: "بانتظار تأكيد الفريق", en: "Awaiting team confirmation" },
  illustrative: { ar: "عرض توضيحي", en: "Illustrative" },
  fromSource: { ar: "الرد يُبنى من هذه البطاقة", en: "The reply is built from this card" },
  suggested: { ar: "قيد الاعتماد", en: "Being finalised" },
  paused: { ar: "في المثال: المتابعة لدى الفريق", en: "In this example: team follow-up" },
  noRepeat: {
    ar: "السياق واضح للفريق عند المتابعة.",
    en: "Clear context for the team’s follow-up.",
  },
  panelTitle: { ar: "الخطوة التالية لكل استفسار", en: "The next step for each enquiry" },
  valuePoints: {
    ar: ["معلومات أوضح للرد", "متابعة منظمة للمهتمين", "خطوة تالية يعرفها الفريق"],
    en: ["Clearer information for replies", "Organised follow-up for interested customers", "A next step the team can see"],
  },
  tabs: {
    ar: ["المحادثات", "الاستفسارات", "المعرفة"],
    en: ["Chats", "Enquiries", "Knowledge"],
  },
  rows: {
    ar: [
      ["استفسار عن ٢ برجر", "بانتظار التأكيد", "الخطوة التالية: مراجعة التفاصيل", "مثال توضيحي"],
      ["سؤال عن منتج", "يحتاج متابعة", "الخطوة التالية: التحقق من التوفر", "مثال توضيحي"],
      ["توصيل خارج مسقط", "يحتاج معلومة", "الخطوة التالية: توضيح نطاق التوصيل", "مثال توضيحي"],
    ],
    en: [
      ["Enquiry for two burgers", "Awaiting confirmation", "Next: review details", "Illustrative example"],
      ["Product question", "Follow-up needed", "Next: check availability", "Illustrative example"],
      ["Delivery outside Muscat", "Information needed", "Next: clarify coverage", "Illustrative example"],
    ],
  },
  steps: {
    ar: [
      { title: "إنشاء الحساب", body: "تنشئ حسابك وتعرّف نشاطك باختصار." },
      { title: "معلومات النشاط", body: "تضيف النص والملفات التي يعتمد عليها الرد لاحقًا." },
      { title: "متطلبات الربط", body: "نراجع متطلبات ربط واتساب وإتاحته لشركتك." },
      { title: "نطاق التجربة", body: "نتفق على حدود التجربة قبل أي تشغيل فعلي." },
    ],
    en: [
      { title: "Create the account", body: "You create your account and briefly describe the business." },
      { title: "Business information", body: "You add the text and files that later replies can rely on." },
      { title: "Connection requirements", body: "Review WhatsApp requirements and availability for your company." },
      { title: "Trial scope", body: "We agree the trial boundaries before any live operation." },
    ],
  },
  sectors: {
    restaurant: { ar: "مطاعم", en: "Restaurants" },
    retail: { ar: "متاجر", en: "Retail" },
    services: { ar: "خدمات", en: "Services" },
  },
  sectorNote: {
    restaurant: {
      ar: "مطاعم: سؤال عن الصنف → معلومة → تفاصيل الاهتمام → مراجعة الفريق.",
      en: "Restaurants: item question → information → interest details → team review.",
    },
    retail: {
      ar: "متاجر: سؤال عن المنتج → معلومة → تفاصيل الاهتمام → مراجعة الفريق.",
      en: "Retail: product question → information → interest details → team review.",
    },
    services: {
      ar: "خدمات: طلب موعد → معلومة → تفاصيل الاهتمام → مراجعة الفريق.",
      en: "Services: slot request → information → interest details → team review.",
    },
  },
  price: { ar: "السعر يُوضح في العرض", en: "Pricing is provided in the offer" },
  allowance: { ar: "السعر والحصة يُحددان في العرض", en: "Price and allowance are set in the offer" },
  choose: { ar: "ناقش هذا المستوى", en: "Discuss this level" },
  selected: { ar: "هذا المستوى محدد للنقاش", en: "This level is selected for discussion" },
  packagesTitle: {
    ar: "فيلورا واحدة. اختر المستوى المناسب لنشاطك.",
    en: "One Velora. Choose the right level for your business.",
  },
  packagesBody: {
    ar: "تصور الاشتراك: منتج واحد وثلاثة مستويات بديلة، بمستوى واحد للشركة وإمكانية الترقية، شهريًا أو سنويًا. التفاصيل والأسعار قيد الاعتماد؛ اختيار المستوى هنا يسجّل اهتمامًا للنقاش.",
    en: "The subscription model: one product and three alternative tiers, with one tier per company, higher-tier upgrades, and monthly or annual terms. Details and prices are being finalised; selection here registers interest.",
  },
  chat: {
    name: { ar: "فيلورا · دليل الصفحة", en: "Velora · Page guide" },
    title: { ar: "دليل الصفحة — ردود محلية", en: "Page guide — local replies" },
    online: { ar: "دليل الصفحة (نصوص جاهزة)", en: "Page guide (scripted replies)" },
    openLabel: { ar: "افتح دليل الصفحة", en: "Open the page guide" },
    bubble: { ar: "محتاج توضيح؟ اسألني بسرعة.", en: "Need a quick clarification? Ask me." },
    welcome: {
      ar: "مرحبًا، أنا فيلورا. أساعدك على فهم الأمثلة والمستويات وكيف تبدأ. هذه محادثة توضيحية بردود معدّة مسبقًا.",
      en: "Hi, I’m Velora. I can help explain the examples, tiers, and how to start. This is an illustrative chat with preset replies.",
    },
    placeholder: { ar: "اكتب سؤالك…", en: "Type your question…" },
    send: { ar: "إرسال", en: "Send" },
    typing: { ar: "فيلورا تكتب…", en: "Velora is typing…" },
    note: {
      ar: "ردود معدّة مسبقًا داخل الصفحة.",
      en: "Preset replies within this page.",
    },
    suggestions: {
      ar: ["كيف تشتغل؟", "المستويات؟", "أبدأ من وين؟"],
      en: ["How does it work?", "Levels?", "Where do I start?"],
    },
    replyHow: {
      ar: "نطوّر فيلورا لتنظيم معلومات النشاط وسياق الاستفسار والخطوة التالية. يمكنك تجهيز الحساب والمعلومات؛ القصة تعرض المسار المستهدف.",
      en: "We’re building Velora around business information, enquiry context, and next actions. You can prepare your account and information; the story shows the intended workflow.",
    },
    replyPlans: {
      ar: "منتج واحد بثلاثة مستويات بديلة، ومستوًى واحد للشركة مع إمكانية الترقية. التفاصيل والأسعار قيد الاعتماد؛ اختيار المستوى هنا يسجّل اهتمامًا للنقاش.",
      en: "One product with three alternative tiers, one tier per company, and higher-tier upgrades. Details and prices are being finalised; selection here registers interest.",
    },
    replyWhatsapp: {
      ar: "تم التحقق من استقبال واتساب لشركة اختبار. الرد بالذكاء الاصطناعي غير مفعّل حاليًا، وإتاحة الربط والتفعيل تُراجع لكل شركة.",
      en: "WhatsApp inbound has been verified for a test company. AI replies are not active, and connection availability is reviewed per company.",
    },
    replyStart: {
      ar: "اضغط «ابدأ تجهيز حسابك» وأكمل معلومات نشاطك، أو تواصل لمناقشة التجربة. التسجيل لا يعني تفعيل الرد الآلي أو شراء اشتراك.",
      en: "Prepare your account and business information, or contact us to discuss a trial. Registration does not activate AI replies or purchase a subscription.",
    },
    fallback: {
      ar: "فهمتك. جرّب سؤال عن المسار، المستويات، أو من وين تبدأ — أو مرّر لقصة الصفحة.",
      en: "Got it. Try asking about the journey, levels, or where to start — or scroll the page story.",
    },
  },
  faqTitle: { ar: "أسئلة قبل ما تبدأ", en: "Questions before you start" },
  aboutTitle: { ar: "من نحن", en: "About us" },
  about: {
    ar: "فيلورا خدمة تابعة لشركة TAG CITY TRAD LLC — تاج المدينة للتجارة ش م م. نطوّر أداة تساعد النشاط على تنظيم معلوماته ومحادثاته ومتابعته. أمثلة الصفحة توضيحية.",
    en: "Velora is a service of TAG CITY TRAD LLC — تاج المدينة للتجارة ش م م. We are building a tool to help businesses organise information, conversations and follow-up. Page examples are illustrative.",
  },
  contactTitle: {
    ar: "لنناقش متابعة العملاء في نشاطك.",
    en: "Let’s discuss your customer follow-up.",
  },
  privacyTitle: { ar: "معلومات الخصوصية", en: "Privacy information" },
  privacy: {
    ar: "نحفظ لغة الصفحة على جهازك. نص التواصل يُجهَّز عندك ويُفتح في بريدك إلى velorahelperai@gmail.com، ولا يُرسل من خادمنا. بعد التسجيل نحتفظ بالاسم وبيانات النشاط والملفات المرتبطة بحسابك إلى أن تطلب حذفها.",
    en: "We keep the page language on your device. The contact note is prepared on your side and opens in your mail app to velorahelperai@gmail.com; our server does not send it. After registration we keep your name, business details and files linked to your account until you ask for them to be deleted.",
  },
  businessName: { ar: "اسم النشاط (اختياري)", en: "Business name (optional)" },
  sectorField: { ar: "نوع النشاط", en: "Business type" },
  planField: { ar: "المستوى", en: "Level" },
  questionField: {
    ar: "ما الذي تريد تحسينه في المتابعة؟",
    en: "What would you like to improve in follow-up?",
  },
  prepare: {
    ar: "انسخ رسالتك وافتح البريد",
    en: "Copy your note and open email",
  },
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
  mailSubject: { ar: "نقاش متابعة العملاء — فيلورا", en: "Customer follow-up discussion — Velora" },
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
    packages: { ar: "المستويات", en: "Levels" },
    faq: { ar: "الأسئلة الشائعة", en: "FAQ" },
  },
  footer: {
    about: { ar: "من نحن", en: "About us" },
    how: { ar: "كيف تعمل", en: "How it works" },
    activities: { ar: "الأنشطة", en: "Business types" },
    packages: { ar: "المستويات", en: "Levels" },
    faq: { ar: "الأسئلة الشائعة", en: "FAQ" },
    contact: { ar: "تواصل معنا", en: "Contact us" },
    privacy: { ar: "الخصوصية", en: "Privacy" },
    terms: { ar: "شروط الاستخدام", en: "Terms of use" },
    deletion: { ar: "حذف الحساب والبيانات", en: "Delete account and data" },
  },
  faq: [
  {
    "q": {
      "ar": "هل الرد الآلي وواتساب مفعّلان الآن؟",
      "en": "Are automated replies and WhatsApp active?"
    },
    "a": {
      "ar": "تم التحقق من استقبال واتساب لشركة اختبار. الرد بالذكاء الاصطناعي غير مفعّل حاليًا، وإتاحة الربط والتفعيل تُراجع لكل شركة.",
      "en": "WhatsApp inbound has been verified for a test company. AI replies are not active, and connection availability is reviewed per company."
    }
  },
  {
    "q": {
      "ar": "كيف تُجهَّز معرفة النشاط؟",
      "en": "How is business knowledge prepared?"
    },
    "a": {
      "ar": "يمكنك إضافة نص وملفات مثل PDF وTXT وDOCX ليُستخرج نصها ويُحفظ لحسابك. هذا تجهيز للمعلومات، وليس ردًا آليًا للعملاء.",
      "en": "You can add text and files such as PDF, TXT and DOCX so their text is extracted and saved to your account. That prepares information. It does not send an automatic reply to customers."
    }
  },
  {
    "q": {
      "ar": "هل تؤكد فيلورا الطلبات والمواعيد؟",
      "en": "Does Velora confirm orders and bookings?"
    },
    "a": {
      "ar": "الأمثلة تعرض استفسارًا ينتظر مراجعة الفريق. لا تمثل تنفيذ طلب مبيعات أو تأكيد حجز أو ربطًا حيًا بالمخزون.",
      "en": "The examples show enquiries awaiting team review. They do not represent completed orders, confirmed bookings, or live stock access."
    }
  },
  {
    "q": {
      "ar": "هل أقدر أعرف أين تتوقف المتابعة؟",
      "en": "Can I see where follow-up stalls?"
    },
    "a": {
      "ar": "هذا اتجاه لخدمة مستقبلية: قياس تأخر الرد والمتابعات المعلقة بناءً على بيانات متفق عليها، وبعد موافقتك وتحديد نطاق استخدامها. لا توجد في هذه الصفحة أداة لرفع محادثات العملاء وتحليلها.",
      "en": "This is a future service direction: measuring reply delays and pending follow-ups using agreed data, with consent and a defined scope. This page does not upload or analyse customer conversations."
    }
  },
  {
    "q": {
      "ar": "كيف نبدأ؟",
      "en": "How do we start?"
    },
    "a": {
      "ar": "اضغط «ابدأ تجهيز حسابك» وأكمل معلومات نشاطك، أو تواصل لمناقشة التجربة. التسجيل لا يعني تفعيل الرد الآلي أو شراء اشتراك.",
      "en": "Prepare your account and business information, or contact us to discuss a trial. Registration does not activate AI replies or purchase a subscription."
    }
  },
  {
    "q": {
      "ar": "ماذا عن النطاق والتكلفة؟",
      "en": "What about scope and cost?"
    },
    "a": {
      "ar": "لا نعرض سعرًا أو حصة محادثات هنا. كلاهما يُحدَّد في العرض المتفق عليه قبل التفعيل.",
      "en": "We do not show a price or a conversation allowance here. Both are set in the agreed offer before activation."
    }
  },
  {
    "q": {
      "ar": "هل أحتاج ثلاثة اشتراكات؟",
      "en": "Do I need three subscriptions?"
    },
    "a": {
      "ar": "التصور منتج واحد بمستوى واحد للشركة، ويمكن الترقية إلى مستوى أعلى. الشهري والسنوي خيارا مدة الاشتراك؛ تفاصيل المستويات قيد الاعتماد.",
      "en": "The model is one product and one tier per company, with higher-tier upgrades. Monthly and annual terms are planned; tier details are being finalised."
    }
  }
],
  samples: {
    restaurant: [
      {
        q: { ar: "البرجر الكلاسيك متوفر اليوم؟", en: "Is the classic burger available today?" },
        a: {
          ar: "نعم، متوفر. تحب كام برجر؟ والتوصيل لفين؟",
          en: "Available. How many burgers? Delivery area?",
        },
      },
    ],
    retail: [
      {
        q: { ar: "هذا المنتج متوفر بالفرع؟", en: "Is this product available in store?" },
        a: {
          ar: "ما المنتج والفرع المطلوبان؟ في هذا المثال، الخطوة التالية أن يتحقق الفريق من التوفر.",
          en: "Which product and branch? In this example, the team checks availability.",
        },
      },
    ],
    services: [
      {
        q: { ar: "فيه موعد بكرة الصبح؟", en: "Is there a morning slot tomorrow?" },
        a: {
          ar: "ما الخدمة والوقت الذي تفضله؟ في هذا المثال، يراجع الفريق الطلب قبل تأكيد الموعد.",
          en: "Which service and time would you prefer? In this example, the team reviews the request before confirming.",
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
    demoContact: t(locale, ui.demoContact),
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
    valuePoints: ui.valuePoints[locale],
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

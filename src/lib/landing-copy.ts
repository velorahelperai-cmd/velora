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
      ar: "كل محادثة طلب محتمل. استقبلها بدقة ووضوح.",
      en: "Every conversation is a potential order. Handle it with speed and precision.",
    },
    body: {
      ar: "في أوقات الذروة تنهال طلبات الوجبات واستفسارات التوصيل. نورا تفهم تفاصيل الطلب وتوضح خيارات القائمة، وتجهّز التفاصيل لفريقك للتحضير والتسليم دون تأخير.",
      en: "Rush hours bring high message volume and meal requests. Noura captures customisations and delivery details, preparing the order so your kitchen prepares without delay.",
    },
    example: {
      ar: {
        question: "مرحبًا، عندكم برجر لحم كلاسيك الحين؟\n\nوجبة لو سمحت، وبدون بصل، ومع بطاطس حار.\n\nتوصيل إلى القرم، كم الوقت تقريبًا؟",
        answer: "أهلًا بك! نعم متوفر طازج. تحب وجبة مع بطاطس ومشروب؟\n\nممتاز! وجبة برجر بدون بصل وبطاطس حار. توصيل ولا استلام؟\n\nيستغرق 30-40 دقيقة. جهّزت بيانات طلبك للفريق لتأكيده!",
        cardTitle: "أسئلة صاحب النشاط",
        card: "مين مستني رد؟\nأي استفسار محتاج متابعة؟\nإيه الخطوة اللي تقرّب العميل؟",
      },
      en: {
        question: "Hi, is the classic beef burger available now?\n\nA meal please, no onions, with spicy fries.\n\nDelivery to Qurum, how long will it take?",
        answer: "Hello! Freshly made today. Meal with fries & drink?\n\nPerfect! Burger meal without onions & spicy fries. Delivery?\n\nTakes 30-40 mins. Order details prepared for our team!",
        cardTitle: "Owner questions",
        card: "Who is waiting for a reply?\nWhich enquiry needs follow-up?\nWhat’s the next step?",
      },
    },
    chips: {
      ar: [
        "البرجر متوفر؟",
        "التوصيل للقرم؟",
        "بدون بصل؟",
        "كم وقت التوصيل؟",
        "مين يتابع الطلب؟",
        "بطاطس حار؟",
        "جاهز للاستلام؟",
      ],
      en: [
        "Available now?",
        "Delivery to Qurum?",
        "No onions?",
        "How long for delivery?",
        "Who preps the order?",
        "Spicy fries?",
        "Ready for pickup?",
      ],
    },
  },
  {
    id: 2,
    key: "knowledge",
    theme: "light" as const,
    anchor: "how",
    title: {
      ar: "الرد الموثوق يبدأ بمعلومات فندقية معتمدة.",
      en: "Reliable hospitality replies start with verified info.",
    },
    body: {
      ar: "مواعيد الدخول، أنواع الغرف، والمرافق؛ تستند نورا إلى بيانات الفندق المعتمدة لتقديم إجابات موثوقة للضيوف وتجهيز بيانات الحجز لفريق الاستقبال بسلاسة.",
      en: "Check-in times, room categories, and amenities; Noura relies on verified hotel information to assist guests and prep reservation details for your front desk.",
    },
    example: {
      ar: {
        question: "مرحبًا، هل متوفر جناح مطل على البحر لنهاية الأسبوع؟\n\nنعم، وهل بوفيه الإفطار مشمول بالحجز؟\n\nممتاز، موعد تسجيل الدخول الساعة كم؟",
        answer: "أهلًا بك! نعم متوفر. هل الإقامة ليلتان لشخصين؟\n\nنعم، يشمل الإفطار ودخول المسبح والنادي الصحي مجانًا.\n\nتسجيل الدخول من 2:00 ظهرًا. جهّزت تفاصيل حجزك للاستقبال!",
        cardTitle: "ملخص للاستقبال",
        card: "الجناح: إطلالة بحرية · ليلتان لشخصين\nالمزايا: إفطار مفتوح ومرافق مجانية\nالمطلوب: مراجعة التوفر وتأكيد الحجز",
      },
      en: {
        question: "Hi, sea view suite available this weekend?\n\nYes, and is breakfast buffet included?\n\nGreat, what time is check-in?",
        answer: "Welcome! Yes available. 2 nights for 2 guests?\n\nYes, breakfast plus pool and health club access included.\n\nCheck-in from 2:00 PM. Booking details prepared for reception!",
        cardTitle: "Reception summary",
        card: "Suite: Sea view · 2 nights for 2 guests\nIncludes: Daily breakfast & pool access\nAction: Verify availability & confirm",
      },
    },
  },
  {
    id: 3,
    key: "reply",
    theme: "dark" as const,
    anchor: "reply",
    title: {
      ar: "مساعدة فورية تقود العميل إلى إتمام الشراء.",
      en: "Instant guidance that turns shoppers into buyers.",
    },
    body: {
      ar: "العملاء يسألون عن المواصفات، التوفر، والضمان. نورا ترشدهم للمنتج المناسب وتوضح خيارات الشحن، حتى تكتمل تفاصيل الطلب لفريق المبيعات.",
      en: "Shoppers ask about specifications, availability, and warranty. Noura guides them to the right product and clarifies delivery, completing details for your sales team.",
    },
    example: {
      ar: {
        question: "مرحبًا، هل سماعات بلوتوث برو متوفرة بلون أسود؟\n\nهل عليها ضمان؟ وهل يتوفر توصيل لنزوى؟\n\nممتاز، احجز لي حبة لون أسود.",
        answer: "أهلًا بك! نعم متوفرة باللون الأسود مع عزل الضوضاء.\n\nنعم، ضمان سنتين وتوصيل خلال 24-48 ساعة لجميع المناطق.\n\nجهّزت طلب حجز السماعة والعنوان لمراجعة فريق المبيعات؛ الحجز لم يُؤكد بعد.",
        cardTitle: "ملخص للفريق",
        card: "الصنف: سماعات بلوتوث برو (أسود)\nالضمان: سنتان شامل · توصيل لنزوى\nالمطلوب: حجز القطعة وتأكيد الشحن",
      },
      en: {
        question: "Hi, are Pro Bluetooth earbuds in stock in black?\n\nIs there warranty? And delivery to Nizwa?\n\nGreat, please reserve one in black for me.",
        answer: "Hello! In stock in matte black with noise cancelling.\n\nYes, 2-year warranty and 24-48h delivery to all areas.\n\nReservation request and address prepared for sales review; reservation is not confirmed.",
        cardTitle: "Summary for the team",
        card: "Item: Pro Earbuds (Matte Black)\nWarranty: 2-year · Delivery to Nizwa\nAction: Reserve item & confirm dispatch",
      },
    },
  },
  {
    id: 4,
    key: "enquiry",
    theme: "light" as const,
    anchor: "enquiry",
    title: {
      ar: "تنظيم استفسارات المواعيد لمراجعة فريق الاستقبال.",
      en: "Appointment enquiry intake for reception review.",
    },
    body: {
      ar: "استفسارات المواعيد، التخصصات، والتغطيات التأمينية تتطلب تنظيمًا فوريًا. نورا تساعد المراجعين إداريًا في اختيار الموعد المناسب وتجهيز الملف للاستقبال، دون تقديم أي استشارات طبية.",
      en: "Appointments, specialties, and insurance coverage need clear administrative intake. Noura helps patients find suitable slots and prepares the file for reception, strictly without medical advice.",
    },
    example: {
      ar: {
        question: "مرحبًا، أحتاج حجز موعد في عيادة الأسنان بكرة؟\n\nموعد 5:30 مناسب، هل تقبلون تأمين شركة ظفار؟\n\nممتاز، اعتمدي الموعد باسم أحمد.",
        answer: "أهلًا بك. متوفر موعد غدًا الساعة 5:30 مساءً أو 7:00 مساءً.\n\nنعم، معتمدون للتغطية المباشرة مع تأمين ظفار.\n\nجهّزت طلب موعد 5:30 غدًا لمراجعة الاستقبال؛ الموعد لم يُؤكد بعد.",
        cardTitle: "ملخص للاستقبال",
        card: "القسم: طب وجراحة الأسنان\nالموعد: غدًا 5:30 مساءً (المريض: أحمد)\nالتأمين: شركة ظفار (مشمول الشبكة)\nالمطلوب: تأكيد الحجز وتجهيز الملف",
      },
      en: {
        question: "Hi, I need a dental clinic appointment tomorrow?\n\n5:30 PM works. Do you accept Dhofar Insurance?\n\nGreat, please book the slot under Ahmed.",
        answer: "Hello. Slots available tomorrow at 5:30 PM or 7:00 PM.\n\nYes, we are an approved network provider for Dhofar.\n\nRequested 5:30 PM tomorrow; reception must confirm the appointment.",
        cardTitle: "Reception summary",
        card: "Dept: Dental Care\nSlot: Tomorrow 5:30 PM (Patient: Ahmed)\nInsurance: Dhofar Insurance (In-network)\nAction: Confirm booking & prep patient file",
      },
    },
  },
  {
    id: 5,
    key: "handoff",
    theme: "dark" as const,
    anchor: "handoff",
    title: {
      ar: "تنظيم طلبات حجز الصالون لمراجعة الفريق.",
      en: "Salon booking requests for team review.",
    },
    body: {
      ar: "باقات العناية، الجلسات، وتفضيلات الأخصائية. نورا ترتب تفاصيل الموعد وتسلّم السياق كاملًا لفريق الصالون لتأكيد الحجز واستقبال العميلات بأفضل تجربة.",
      en: "Treatment packages, sessions, and specialist preferences. Noura organizes appointment details and hands off full context to your salon team to confirm and welcome clients.",
    },
    example: {
      ar: {
        question: "مرحبًا، أريد حجز جلسة عناية بالشعر يوم السبت.\n\nالعصر حوالي 4، وهل الأخصائية ريم متواجدة؟\n\nرائع، احجزي لي هذا الموعد لو سمحتِ.",
        answer: "أهلاً بكِ! متاح يوم السبت. تفضلين فترة الصباح أم المساء؟\n\nنعم، الأخصائية ريم متواجدة الساعة 4:00 عصرًا.\n\nجهّزت طلب السبت 4:00 عصرًا مع ريم لمراجعة الاستقبال؛ الحجز لم يُؤكد بعد.",
        cardTitle: "ملخص للفريق",
        card: "الخدمة: جلسة عناية بالشعر\nالموعد: السبت 4:00 عصرًا\nالأخصائية: ريم\nالمطلوب: مراجعة الجدول وتأكيد الحجز",
      },
      en: {
        question: "Hi, I'd like to book a hair care session this Saturday.\n\nAfternoon around 4 PM. Is specialist Reem available?\n\nWonderful, please reserve this slot for me.",
        answer: "Welcome! Open this Saturday. Morning or afternoon?\n\nYes, specialist Reem is available at 4:00 PM.\n\nRequested Saturday 4:00 PM with Reem; the salon team must confirm the slot.",
        cardTitle: "Summary for the team",
        card: "Service: Hair care treatment\nSlot: Saturday 4:00 PM\nSpecialist: Reem\nAction: Review schedule & confirm booking",
      },
    },
  },
  {
    id: 6,
    key: "overview",
    theme: "light" as const,
    anchor: "overview",
    title: {
      ar: "كل محادثة واضحة، وكل متابعة في مكانها.",
      en: "Every conversation is clear, and every follow-up is in place.",
    },
    body: {
      ar: "فيلورا تساعد فريقك يفهم طلب العميل، ويميز المعلومات المؤكدة عن التفاصيل التي تحتاج مراجعة، ويعرف الخطوة التالية دون فقدان سياق المحادثة.",
      en: "Velora helps your team understand customer requests, distinguish confirmed details from those needing review, and know the next step without losing conversation context.",
    },
    example: {
      ar: {
        question: "استفسار تجهيز مناسبة",
        answer: "بانتظار متابعة الفريق.",
        cardTitle: "متابعة استفسارات العملاء",
        card: "الحالات · المسؤولون · الأسئلة التي تحتاج مراجعة",
      },
      en: {
        question: "Catering enquiry",
        answer: "Waiting for team follow-up.",
        cardTitle: "Customer Enquiry Follow-up",
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
      ar: "شغلك يكبر، مش ضغطك.",
      en: "Your business grows, not your pressure.",
    },
    body: {
      ar: "لا تفوّت فرصة بسبب رسالة اتأخرت. جهّز مساعدتك الذكية في خطوات بسيطة، وخلي فيلورا تساعدك في متابعة عملائك.",
      en: "Never miss an opportunity from a delayed reply. Set up your AI assistant in simple steps, and let Velora help you follow up with your customers.",
    },
    example: {
      ar: {
        question: "من اختيار الباقة إلى أول تجربة",
        answer: "شغلك يكبر، مش ضغطك.",
        cardTitle: "خطوات التجهيز السلسة",
        card: "اختيار الشخصية ← قاعدة المعرفة ← ربط واتساب ← تجربة الردود",
      },
      en: {
        question: "From plan selection to first experience",
        answer: "Your business grows, not your pressure.",
        cardTitle: "Seamless Setup Steps",
        card: "Assistant Persona → Knowledge Base → WhatsApp Link → Example Reply Review",
      },
    },
  },
  {
    id: 9,
    key: "demo",
    theme: "dark" as const,
    anchor: "demo",
    title: {
      ar: "استقبال بلاغات الصيانة لمراجعة الفريق.",
      en: "Maintenance enquiry intake for team review.",
    },
    body: {
      ar: "أعطال التكييف والسباكة والكهرباء تحتاج استجابة فورية. نورا تفهم نوع العطل وموقع العميل، تجهّز البلاغ كاملًا لمراجعة الفريق وتأكيد أي موعد.",
      en: "AC faults, plumbing, and electrical issues require immediate response. Noura identifies the issue and location, sets priority, and preps the ticket for dispatch.",
    },
    example: {
      ar: {
        question: "مرحبًا، التكييف يقطر ماء وموقّف تبريد، محتاج صيانة عاجلة.\n\nمكيف سبليت وبدأ اليوم، وموقعي في الموالح الجنوبية.\n\nمناسب جدًا الساعة 6، أرسلوا الفني لو سمحتم.",
        answer: "أهلًا بك. هل المكيف سبليت ولا مركزي؟ وبدأ العطل اليوم؟\n\nحالة عاجلة. يتوفر فني صيانة في الموالح اليوم الساعة 6 مساءً.\n\nجهّزت البلاغ والعنوان وطلب زيارة الساعة 6 لمراجعة الفريق؛ الموعد وإرسال الفني يحتاجان تأكيده.",
        cardTitle: "بلاغ الصيانة",
        card: "العطل: تسريب مياه مكيف سبليت · الموالح\nالأولوية: عاجلة (موعد: اليوم 6:00 م)\nالمطلوب: مراجعة توفر الفني وتأكيد الزيارة",
      },
      en: {
        question: "Hi, AC is leaking water and stopped cooling, need urgent repair.\n\nSplit unit, started today. Location is South Al Mawaleh.\n\n6:00 PM works great, please send the technician.",
        answer: "Hello. Is it split or central? Did it start today?\n\nUrgent priority. A technician is available today at 6:00 PM.\n\nIssue, address and requested 6:00 PM visit prepared for team review; scheduling and dispatch require confirmation.",
        cardTitle: "Maintenance Ticket",
        card: "Issue: AC leak & cooling failure · Mawaleh\nPriority: Urgent (Slot: Today 6:00 PM)\nAction: Team to confirm technician availability and visit",
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
  menu: { ar: "عرض المنتجات", en: "View products" },
  catalogueTitle: { ar: "المنتجات المتوفرة", en: "Available Products" },
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
  illustrativeBadge: { ar: "أمثلة توضيحية", en: "Illustrative examples" },
  panelTitle: { ar: "متابعة استفسارات العملاء", en: "Customer Enquiry Follow-up" },
  valuePoints: {
    ar: [
      "ملخص واضح لكل محادثة",
      "تحديد الاستفسارات التي تحتاج متابعة",
      "الخطوة التالية واضحة للفريق",
    ],
    en: [
      "Clear summary for each conversation",
      "Identify enquiries requiring follow-up",
      "The next step is clear for the team",
    ],
  },
  tabs: {
    ar: ["المحادثات", "الاستفسارات", "المعرفة"],
    en: ["Chats", "Enquiries", "Knowledge"],
  },
  rows: {
    ar: [
      ["طلب ٢ برجر", "بانتظار التأكيد", "الخطوة التالية: مراجعة تفاصيل الطلب قبل اعتماده."],
      ["استفسار عن توفر وجبة", "يحتاج تحققًا", "الخطوة التالية: التأكد من توفر الصنف."],
      ["توصيل خارج مسقط", "يحتاج معلومات", "الخطوة التالية: تحديد المنطقة والتأكد من نطاق التوصيل."],
    ],
    en: [
      ["Order for 2 burgers", "Awaiting confirmation", "Next step: Review order details before confirming."],
      ["Meal availability enquiry", "Needs verification", "Next step: Check item availability."],
      ["Delivery outside Muscat", "Needs information", "Next step: Identify area and confirm delivery coverage."],
    ],
  },
  steps: {
    ar: [
      { title: "مساعدتك على ذوقك", body: "اختر شخصية المساعد الذكي التي تمثل هويتك ونبرة الحديث المناسبة لعملائك (نورا، لينا، دانة)، وحدد باقتك." },
      { title: "عرّفها على شغلك", body: "أضف قائمة منتجاتك، أسعارك، ساعات العمل، وسياسات التوصيل أو الحجز. نورا تعتمد فقط على ما تعتمده لها." },
      { title: "وصّل واتساب شغلك", body: "اربط رقم واتساب نشاطك عبر Meta Cloud API الرسمي بخطوات سريعة وآمنة دون تعقيدات تقنية." },
      { title: "جرّبها… وشوف الفارق", body: "استعرض ردودًا معدّة مسبقًا ببيانات افتراضية. الاختبار الفعلي المصرّح به منفصل ولا يفعّل واتساب." },
    ],
    en: [
      { title: "Your assistant, tailored to you", body: "Choose the AI persona that represents your brand and voice (Noura, Lina, Dana), and select your plan." },
      { title: "Teach her your business", body: "Add your product catalogue, pricing, business hours, and delivery or booking policies. Noura relies strictly on your approved data." },
      { title: "Connect your business WhatsApp", body: "Connect your business WhatsApp number through the official Meta Cloud API with fast, secure steps." },
      { title: "Test her out… see the difference", body: "Review preset replies using fictional data. Authorized real trials are separate and do not activate WhatsApp." },
    ],
  },
  onboardingStory: {
    eyebrow: {
      ar: "من اختيار الباقة إلى أول تجربة",
      en: "From Plan Selection to First Experience",
    },
    headline: {
      ar: "شغلك يكبر، مش ضغطك.",
      en: "Your business grows, not your pressure.",
    },
    supporting: {
      ar: "لا تفوّت فرصة بسبب رسالة اتأخرت. جهّز مساعدتك الذكية في خطوات بسيطة، وخلي فيلورا تساعدك في متابعة عملائك.",
      en: "Never miss an opportunity from a delayed reply. Set up your AI assistant in simple steps, and let Velora help you follow up with your customers.",
    },
    stages: [
      {
        id: "assistant",
        number: "01",
        tag: { ar: "الشخصية والباقة", en: "Persona & Plan" },
        title: { ar: "مساعدتك على ذوقك.", en: "Your assistant, tailored to you." },
        body: {
          ar: "اختر شخصية المساعد الذكي التي تمثل هويتك ونبرة الحديث المناسبة لعملائك (نورا، لينا، دانة)، وحدد باقتك.",
          en: "Choose the AI persona that represents your brand and voice (Noura, Lina, Dana), and select your plan.",
        },
      },
      {
        id: "knowledge",
        number: "02",
        tag: { ar: "قاعدة المعرفة", en: "Knowledge Base" },
        title: { ar: "عرّفها على شغلك.", en: "Teach her your business." },
        body: {
          ar: "أضف قائمة منتجاتك، أسعارك، ساعات العمل، وسياسات التوصيل أو الحجز. نورا تعتمد فقط على ما تعتمده لها.",
          en: "Add your product catalogue, pricing, business hours, and delivery or booking policies. Noura relies strictly on your approved data.",
        },
      },
      {
        id: "whatsapp",
        number: "03",
        tag: { ar: "ربط واتساب", en: "WhatsApp Integration" },
        title: { ar: "وصّل واتساب شغلك.", en: "Connect your business WhatsApp." },
        body: {
          ar: "اربط رقم واتساب نشاطك عبر Meta Cloud API الرسمي بخطوات سريعة وآمنة دون تعقيدات تقنية.",
          en: "Connect your business WhatsApp number through the official Meta Cloud API with fast, secure steps.",
        },
      },
      {
        id: "test",
        number: "04",
        tag: { ar: "بيئة التجربة والجاهزية", en: "Interactive Test Sandbox" },
        title: { ar: "جرّبها… وشوف الفارق.", en: "Test her out… see the difference." },
        body: {
          ar: "استعرض ردودًا معدّة مسبقًا ببيانات افتراضية. الاختبار الفعلي المصرّح به منفصل ولا يفعّل واتساب.",
          en: "Review preset replies using fictional data. Authorized real trials are separate and do not activate WhatsApp.",
        },
      },
    ],
    previewUI: {
      appTitle: {
        ar: "لوحة تحكم فيلورا — إعداد المساعد",
        en: "Velora Dashboard — Assistant Setup",
      },
      previewBadge: {
        ar: "معاينة توضيحية",
        en: "Illustrative Preview",
      },
      characters: {
        noura: {
          name: { ar: "نورا", en: "Noura" },
          role: { ar: "خدمة عملاء دافئة", en: "Warm Customer Care" },
          dialect: { ar: "خليجية وعربية بيضاء", en: "Gulf & Clear Arabic" },
          badge: { ar: "المختارة في المثال", en: "Selected in example" },
        },
        lina: {
          name: { ar: "لينا", en: "Lina" },
          role: { ar: "أسلوب عصري ومرن", en: "Modern & Agile Voice" },
          dialect: { ar: "عربية فصحى مبسطة", en: "Modern Standard Arabic" },
        },
        dana: {
          name: { ar: "دانة", en: "Dana" },
          role: { ar: "طابع هادئ واحترافي", en: "Calm & Professional" },
          dialect: { ar: "نبرة تنفيذية دقيقة", en: "Corporate Executive Tone" },
        },
      },
      plans: {
        basic: {
          ar: "نورا الأساسية — السعر من الكتالوج المنشور",
          en: "Noura Basic — pricing from published catalog",
        },
        premium: {
          ar: "Premium — مسودة غير متاحة",
          en: "Premium — draft, unavailable",
        },
        note: {
          ar: "الأسعار والحدود من الكتالوج المنشور؛ المعاينة لا تنشئ اشتراكًا",
          en: "Prices and limits come from the published catalog; this preview creates no subscription",
        },
      },
      knowledge: {
        header: {
          ar: "مثال لبيانات نشاط افتراضي",
          en: "Example Fictional Business Knowledge",
        },
        businessNameLabel: {
          ar: "اسم النشاط التجاري",
          en: "Business Name",
        },
        businessNameValue: {
          ar: "مقهى ومحمص الأصول",
          en: "Al Osool Café & Roastery",
        },
        servicesLabel: {
          ar: "المنتجات وقائمة الخدمات",
          en: "Products & Menu Services",
        },
        servicesValue: {
          ar: "قهوة مختصة (V60، فلات وايت، كولد برو)، حلويات طازجة، بوكسات الجمعات والفعاليات.",
          en: "Specialty coffee (V60, Flat White, Cold Brew), fresh desserts, gathering & event boxes.",
        },
        hoursLabel: {
          ar: "أوقات العمل والأسعار",
          en: "Operating Hours & Pricing",
        },
        hoursValue: {
          ar: "يوميًا: 7:00 ص – 11:30 م (الجمعة من 1:00 م) · الأسعار: تبدأ من 1.500 ر.ع حتى 14.000 ر.ع.",
          en: "Daily: 7:00 AM – 11:30 PM (Friday from 1:00 PM) · Prices: from 1.500 OMR to 14.000 OMR.",
        },
        policyLabel: {
          ar: "سياسة التوصيل ومناطق التغطية",
          en: "Delivery Policy & Coverage",
        },
        policyValue: {
          ar: "توصيل فوري خلال 35 دقيقة لمسقط والمناطق المجاورة عبر المندوب الخاص.",
          en: "Express 35-min delivery across Muscat and surrounding areas via dedicated courier.",
        },
        statusApproved: {
          ar: "بيانات مثال؛ لا تمثل اعتمادًا فعليًا",
          en: "Example data; no actual approval is shown",
        },
        statusSubtext: {
          ar: "الاعتماد الفعلي منفصل ويخضع للمراجعة",
          en: "Actual knowledge approval requires separate review",
        },
      },
      whatsapp: {
        header: {
          ar: "ربط رقم واتساب التجاري الرسمي",
          en: "Connect Official WhatsApp Business",
        },
        phoneNumber: "+968 91•• ••42",
        wabaTitle: {
          ar: "رقم النشاط التجاري",
          en: "Business Number",
        },
        accountStatus: {
          ar: "مثال لقناة اتصال؛ الربط غير منفّذ هنا",
          en: "Example connection; no link is established here",
        },
        steps: [
          {
            label: {
              ar: "التحقق من ملكية الرقم عبر Meta OTP",
              en: "Verify number ownership via Meta OTP",
            },
          },
          {
            label: {
              ar: "ربط حساب WhatsApp Business (WABA)",
              en: "Connect WhatsApp Business Account (WABA)",
            },
          },
          {
            label: {
              ar: "مزامنة قناة استقبال المحادثات",
              en: "Sync inbound conversation channel",
            },
          },
        ],
        syncNotice: {
          ar: "الربط الفعلي يتطلب إعداد ميتا والتفويض والمراجعة؛ هذا المثال لا يربط رقمًا أو يفعّل رسائل.",
          en: "Actual linking requires Meta setup, authorization and review; this example connects no number or messaging.",
        },
      },
      chatTest: {
        header: {
          ar: "مثال لردود نورا المعدّة مسبقًا",
          en: "Preset Noura Reply Example",
        },
        onlineStatus: {
          ar: "ردود معدّة مسبقًا · لا يتم إرسال رسائل",
          en: "Preset replies · No messages are sent",
        },
        sandboxBadge: {
          ar: "محادثة توضيحية ببيانات افتراضية",
          en: "Illustrative conversation with fictional data",
        },
        messages: [
          {
            role: "customer" as const,
            text: {
              ar: "مرحبًا، متوفر بوكس قهوة الجمعات مع الحلى اليوم؟",
              en: "Hi, is the gatherings coffee box with sweets available today?",
            },
          },
          {
            role: "assistant" as const,
            text: {
              ar: "أهلًا بك! نعم متوفر بوكس الجمعات (يكفي 8 أشخاص) مع خيار الحلى المفضل. تحب استلام من الفرع أو توصيل؟",
              en: "Hello! Yes, the gatherings box (serves 8) is available with your choice of sweets. Pick up or delivery?",
            },
          },
          {
            role: "customer" as const,
            text: {
              ar: "توصيل إلى العذيبة لو سمحت، خلال كم يوصل؟",
              en: "Delivery to Azaiba please, how long will it take?",
            },
          },
          {
            role: "assistant" as const,
            text: {
              ar: "التوصيل إلى العذيبة يستغرق حوالي 30 إلى 35 دقيقة. جهّزت بيانات طلبك للفريق لتأكيده مباشرة!",
              en: "Delivery to Azaiba takes around 30 to 35 minutes. Order details prepared for our team to confirm right away!",
            },
          },
        ],
        readinessHeader: {
          ar: "عناصر مراجعة توضيحية؛ ليست حالة إطلاق:",
          en: "Illustrative review items; not launch status:",
        },
        readinessList: [
          {
            text: {
              ar: "مراجعة النبرة واللهجة",
              en: "Review tone and dialect",
            },
            done: false,
          },
          {
            text: {
              ar: "مراجعة الالتزام بمعرفة النشاط",
              en: "Review use of approved business knowledge",
            },
            done: false,
          },
          {
            text: {
              ar: "مراجعة مسار طلب متابعة الفريق",
              en: "Review staff follow-up request",
            },
            done: false,
          },
          {
            text: {
              ar: "مراجعة توثيق رقم واتساب",
              en: "Review WhatsApp number verification",
            },
            done: false,
          },
        ],
      },
    },
  },
  sectors: {
    restaurant: { ar: "مطاعم", en: "Restaurants" },
    retail: { ar: "متاجر", en: "Retail" },
    services: { ar: "خدمات", en: "Services" },
  },
  sectorNote: {
    restaurant: {
      ar: "مطاعم وكافيهات: استفسار القائمة ← تفاصيل الوجبة والإضافات ← العنوان والوقت ← إحالة للتجهيز.",
      en: "Restaurants & cafés: menu enquiry → order customisation → delivery address → team review.",
    },
    retail: {
      ar: "متاجر وتجارة إلكترونية: توفر الصنف ← المواصفات والضمان ← طلب حجز القطعة ← مراجعة فريق المبيعات والشحن.",
      en: "Retail & e-commerce: item availability → specs & warranty → reservation request → team review.",
    },
    services: {
      ar: "صيانة وخدمات منزلية: وصف العطل ← تحديد الاستعجال والعنوان ← طلب الموعد ← مراجعة توفر الفني.",
      en: "Home services & maintenance: issue description → urgency & location → requested time slot → team review before dispatch.",
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
        q: {
          ar: "مرحبًا، عندكم برجر لحم كلاسيك الحين؟\n\nوجبة لو سمحت، وبدون بصل، ومع بطاطس حار.\n\nتوصيل إلى القرم، كم الوقت تقريبًا؟",
          en: "Hi, is the classic beef burger available now?\n\nA meal please, no onions, with spicy fries.\n\nDelivery to Qurum, how long will it take?",
        },
        a: {
          ar: "أهلًا بك! نعم متوفر طازج. تحب وجبة مع بطاطس ومشروب؟\n\nممتاز! وجبة برجر بدون بصل وبطاطس حار. توصيل ولا استلام؟\n\nيستغرق 30-40 دقيقة. جهّزت بيانات طلبك للفريق لتأكيده!",
          en: "Hello! Freshly made today. Meal with fries & drink?\n\nPerfect! Burger meal without onions & spicy fries. Delivery?\n\nTakes 30-40 mins. Order details prepared for our team!",
        },
      },
    ],
    retail: [
      {
        q: {
          ar: "مرحبًا، هل سماعات بلوتوث برو متوفرة بلون أسود؟\n\nهل عليها ضمان؟ وهل يتوفر توصيل لنزوى؟\n\nممتاز، احجز لي حبة لون أسود.",
          en: "Hi, are Pro Bluetooth earbuds in stock in black?\n\nIs there warranty? And delivery to Nizwa?\n\nGreat, please reserve one in black for me.",
        },
        a: {
          ar: "أهلًا بك! نعم متوفرة باللون الأسود مع عزل الضوضاء.\n\nنعم، ضمان سنتين وتوصيل خلال 24-48 ساعة لجميع المناطق.\n\nجهّزت طلب حجز السماعة والعنوان لمراجعة فريق المبيعات؛ الحجز لم يُؤكد بعد.",
          en: "Hello! In stock in matte black with noise cancelling.\n\nYes, 2-year warranty and 24-48h delivery to all areas.\n\nReservation request and address prepared for sales review; reservation is not confirmed.",
        },
      },
    ],
    services: [
      {
        q: {
          ar: "مرحبًا، التكييف يقطر ماء وموقّف تبريد، محتاج صيانة عاجلة.\n\nمكيف سبليت وبدأ اليوم، وموقعي في الموالح الجنوبية.\n\nمناسب جدًا الساعة 6، أرسلوا الفني لو سمحتم.",
          en: "Hi, AC is leaking water and stopped cooling, need urgent repair.\n\nSplit unit, started today. Location is South Al Mawaleh.\n\n6:00 PM works great, please send the technician.",
        },
        a: {
          ar: "أهلًا بك. هل المكيف سبليت ولا مركزي؟ وبدأ العطل اليوم؟\n\nحالة عاجلة. يتوفر فني صيانة في الموالح اليوم الساعة 6 مساءً.\n\nجهّزت البلاغ والعنوان وطلب زيارة الساعة 6 لمراجعة الفريق؛ الموعد وإرسال الفني يحتاجان تأكيده.",
          en: "Hello. Is it split or central? Did it start today?\n\nUrgent priority. A technician is available today at 6:00 PM.\n\nIssue, address and requested 6:00 PM visit prepared for team review; scheduling and dispatch require confirmation.",
        },
      },
    ],
  },
  catalogue: {
    ar: ["سماعات بلوتوث برو", "ساعة رياضية ذكية", "شاحن سريع 65W"],
    en: ["Pro Wireless Earbuds", "Smart Fitness Watch", "65W Fast Charger"],
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
    illustrativeBadge: t(locale, ui.illustrativeBadge),
    panelTitle: t(locale, ui.panelTitle),
    valuePoints: ui.valuePoints[locale],
    tabs: ui.tabs[locale],
    rows: ui.rows[locale],
    steps: ui.steps[locale],
    onboardingStory: {
      eyebrow: t(locale, ui.onboardingStory.eyebrow),
      headline: t(locale, ui.onboardingStory.headline),
      supporting: t(locale, ui.onboardingStory.supporting),
      stages: ui.onboardingStory.stages.map((stage) => ({
        id: stage.id,
        number: stage.number,
        tag: t(locale, stage.tag),
        title: t(locale, stage.title),
        body: t(locale, stage.body),
      })),
      previewUI: {
        appTitle: t(locale, ui.onboardingStory.previewUI.appTitle),
        previewBadge: t(locale, ui.onboardingStory.previewUI.previewBadge),
        characters: {
          noura: {
            name: t(locale, ui.onboardingStory.previewUI.characters.noura.name),
            role: t(locale, ui.onboardingStory.previewUI.characters.noura.role),
            dialect: t(locale, ui.onboardingStory.previewUI.characters.noura.dialect),
            badge: t(locale, ui.onboardingStory.previewUI.characters.noura.badge),
          },
          lina: {
            name: t(locale, ui.onboardingStory.previewUI.characters.lina.name),
            role: t(locale, ui.onboardingStory.previewUI.characters.lina.role),
            dialect: t(locale, ui.onboardingStory.previewUI.characters.lina.dialect),
          },
          dana: {
            name: t(locale, ui.onboardingStory.previewUI.characters.dana.name),
            role: t(locale, ui.onboardingStory.previewUI.characters.dana.role),
            dialect: t(locale, ui.onboardingStory.previewUI.characters.dana.dialect),
          },
        },
        plans: {
          basic: t(locale, ui.onboardingStory.previewUI.plans.basic),
          premium: t(locale, ui.onboardingStory.previewUI.plans.premium),
          note: t(locale, ui.onboardingStory.previewUI.plans.note),
        },
        knowledge: {
          header: t(locale, ui.onboardingStory.previewUI.knowledge.header),
          businessNameLabel: t(locale, ui.onboardingStory.previewUI.knowledge.businessNameLabel),
          businessNameValue: t(locale, ui.onboardingStory.previewUI.knowledge.businessNameValue),
          servicesLabel: t(locale, ui.onboardingStory.previewUI.knowledge.servicesLabel),
          servicesValue: t(locale, ui.onboardingStory.previewUI.knowledge.servicesValue),
          hoursLabel: t(locale, ui.onboardingStory.previewUI.knowledge.hoursLabel),
          hoursValue: t(locale, ui.onboardingStory.previewUI.knowledge.hoursValue),
          policyLabel: t(locale, ui.onboardingStory.previewUI.knowledge.policyLabel),
          policyValue: t(locale, ui.onboardingStory.previewUI.knowledge.policyValue),
          statusApproved: t(locale, ui.onboardingStory.previewUI.knowledge.statusApproved),
          statusSubtext: t(locale, ui.onboardingStory.previewUI.knowledge.statusSubtext),
        },
        whatsapp: {
          header: t(locale, ui.onboardingStory.previewUI.whatsapp.header),
          phoneNumber: ui.onboardingStory.previewUI.whatsapp.phoneNumber,
          wabaTitle: t(locale, ui.onboardingStory.previewUI.whatsapp.wabaTitle),
          accountStatus: t(locale, ui.onboardingStory.previewUI.whatsapp.accountStatus),
          steps: ui.onboardingStory.previewUI.whatsapp.steps.map((st) => ({
            label: t(locale, st.label),
          })),
          syncNotice: t(locale, ui.onboardingStory.previewUI.whatsapp.syncNotice),
        },
        chatTest: {
          header: t(locale, ui.onboardingStory.previewUI.chatTest.header),
          onlineStatus: t(locale, ui.onboardingStory.previewUI.chatTest.onlineStatus),
          sandboxBadge: t(locale, ui.onboardingStory.previewUI.chatTest.sandboxBadge),
          messages: ui.onboardingStory.previewUI.chatTest.messages.map((m) => ({
            role: m.role,
            text: t(locale, m.text),
          })),
          readinessHeader: t(locale, ui.onboardingStory.previewUI.chatTest.readinessHeader),
          readinessList: ui.onboardingStory.previewUI.chatTest.readinessList.map((r) => ({
            text: t(locale, r.text),
            done: r.done,
          })),
        },
      },
    },
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

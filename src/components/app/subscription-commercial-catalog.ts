import type { SubscriptionOfferView, SubscriptionPackage, SubscriptionPersona, SubscriptionTerm } from "./subscription-offers-view";

/** Owner-approved commercial specification, versioned with the application.
 * It describes the offering; only matching, server-qualified billing versions
 * authorize checkout. No synthetic plan/version IDs or payment readiness.
 */
export const legacyCommercialCatalogRevision = "2026-10-14";
export const commercialCatalogRevision = "2026-10-24";
export type CommercialCatalogRevision = typeof commercialCatalogRevision | typeof legacyCommercialCatalogRevision;
export const annualDiscountPercent = 20;
export type CommercialFeature = { id: string; label: { ar: string; en: string } };
export type CommercialPlan = {
  persona: SubscriptionPersona; package: SubscriptionPackage; monthlyBaisa: number;
  replies: number; employees: number; channels: number;
  features: readonly CommercialFeature[]; addons: readonly CommercialFeature[];
};
const f = (id: string, ar: string, en: string): CommercialFeature => ({ id, label: { ar, en } });
const support = [
  f("faq", "الرد على الأسئلة ومعلومات النشاط", "Business information and FAQs"),
  f("knowledge", "الخدمات والأسعار والسياسات بالعربية والإنجليزية", "Services, prices and policies in Arabic and English"),
  f("contacts", "جمع بيانات العملاء والاستفسارات", "Contact and enquiry capture"),
  f("enquiry_handoff", "تحويل المحادثة إلى الموظف المناسب", "Staff handoff"),
  f("history", "سجل المحادثات وردود جاهزة للموظفين", "Conversation history and staff quick replies"),
];
const sales = [...support,
  f("recommendations", "فهم الاحتياج وترشيح المنتجات والخدمات", "Needs discovery and recommendations"),
  f("leads", "تنظيم بيانات العملاء المهتمين", "Lead capture and organization"),
  f("quotes", "تجهيز طلب شراء أو عرض سعر", "Order and quotation requests"),
  f("booking_requests", "جمع تفاصيل المواعيد لتأكيد الموظف", "Appointment requests for staff confirmation"),
  f("manual_reminders", "تذكير الموظف بمتابعة العميل", "Staff follow-up reminders"),
];
const operations = [...support,
  f("orders", "جمع الطلبات والحجوزات لمراجعة الموظف", "Order and booking requests for staff review"),
  f("order_status", "تنظيم متابعة الطلب وتحديثات الموظف", "Order tracking and staff updates"),
  f("change_requests", "تسجيل طلبات التعديل والإلغاء", "Change and cancellation requests"),
  f("reminders", "تذكيرات جاهزة ضمن حدود الباقة", "Bounded ready-made reminders"),
];
export const commercialPlans: readonly CommercialPlan[] = [
  { persona: "level_1", package: "basic", monthlyBaisa: 45000, replies: 1000, employees: 2, channels: 1, features: support, addons: [] },
  { persona: "level_1", package: "premium", monthlyBaisa: 90000, replies: 3000, employees: 4, channels: 2, features: [...support,
    f("case_tracking", "تصنيف الاستفسارات والشكاوى ومتابعة الحالات", "Enquiry classification and case tracking"),
    f("routing", "توجيه المحادثات إلى الفروع والموظفين", "Branch and team routing"),
    f("summaries", "تلخيص المحادثات للموظفين", "Conversation summaries"),
    f("csat", "قياس رضا العملاء", "Customer satisfaction"),
    f("alerts", "تنبيهات التأخير والتقييمات السلبية", "Late conversation and negative feedback alerts"),
    f("reports", "تقارير الخدمة وأداء الفريق", "Service and team reports"),
  ], addons: [f("voice_messages", "فهم الرسائل الصوتية بحصة مستقلة", "Voice-message understanding with a separate allowance")] },
  { persona: "level_2", package: "basic", monthlyBaisa: 65000, replies: 2000, employees: 2, channels: 1, features: sales, addons: [] },
  { persona: "level_2", package: "premium", monthlyBaisa: 120000, replies: 6000, employees: 4, channels: 2, features: [...sales,
    f("lead_followup", "متابعة وتذكيرات آلية بقواعد معتمدة", "Approved automated follow-up and reminders"),
    f("campaigns", "تقسيم العملاء والحملات الموجهة", "Segmentation and targeted campaigns"),
    f("instagram_comments", "الرد على تعليقات إنستغرام والرسائل المرتبطة", "Instagram comment replies and related DMs"),
    f("cart_recovery", "متابعة السلات المتروكة عند ربط المتجر", "Abandoned-cart recovery with a connected store"),
    f("sales_routing", "توزيع العملاء وتقارير التحويل", "Lead assignment and conversion reports"),
    f("sales_workflows", "أتمتة مبيعات جاهزة بحصص محددة", "Bounded ready-made sales workflows"),
  ], addons: [
    f("website", "موقع Velora حتى ٥ صفحات مع نماذج ومحادثة", "Velora website: up to 5 pages, forms and chat"),
    f("store", "متجر Velora كامل بتجهيز مستقل", "Velora store with separately scoped setup"),
    f("calls", "الرد الفعلي على المكالمات وأخذ الطلبات والمواعيد", "AI phone conversations, order and appointment capture"),
    f("content", "إنشاء صور وريلز وقصص مع اعتماد قبل النشر", "Images, reels and stories with approval before publishing"),
    f("advertising", "إدارة الإعلانات بميزانية إعلانية منفصلة", "Ad management with a separate advertising budget"),
  ] },
  { persona: "level_3", package: "basic", monthlyBaisa: 90000, replies: 3000, employees: 2, channels: 1, features: operations, addons: [] },
  { persona: "level_3", package: "premium", monthlyBaisa: 150000, replies: 10000, employees: 4, channels: 2, features: [...operations,
    f("operations_workflows", "أتمتة التشغيل وتوزيع المهام على الفروع", "Operational workflows and branch assignment"),
    f("operations_alerts", "تنبيهات تأخير الطلبات والمهام", "Order and task delay alerts"),
    f("reports", "تقارير الطلبات والتشغيل", "Order and operational reports"),
    f("payment_followup", "متابعة المدفوعات عند تفعيل إضافة الدفع", "Payment follow-up with the payment add-on"),
  ], addons: [
    f("pos", "كاشير Velora للمبيعات والطلبات والفواتير", "Velora POS for sales, orders and invoices"),
    f("stock", "إدارة المنتجات والمخزون والأسعار", "Products, inventory and prices"),
    f("bookings", "حجوزات ومواعيد مع منع التعارض", "Booking availability and conflict prevention"),
    f("endcustomer_payment", "روابط دفع ومقدم أو دفع كامل والتحقق من السداد", "Payment links, deposits and verified payment status"),
    f("accounting", "ربط محاسبي للفواتير والتحصيل والمصروفات", "Accounting integration for invoices, receipts and expenses"),
    f("custom_workflows", "أتمتة مخصصة عبر n8n أو Make", "Custom n8n or Make workflows"),
  ] },
];
export function commercialPlan(persona: SubscriptionPersona, pack: SubscriptionPackage): CommercialPlan {
  return commercialPlans.find(plan => plan.persona === persona && plan.package === pack)!;
}
export function commercialAmount(plan: CommercialPlan, term: SubscriptionTerm): number {
  return term === "yearly" ? plan.monthlyBaisa * 12 * (100 - annualDiscountPercent) / 100 : plan.monthlyBaisa;
}
export function matchesCommercialOffer(offer: SubscriptionOfferView): boolean {
  const plan = commercialPlan(offer.persona, offer.package);
  return !!plan && offer.currency === "OMR" && offer.amountBaisa === commercialAmount(plan, offer.term)
    && offer.automatedOutboundPerMonth === plan.replies;
}
export function matchingCommercialOffer(plan: CommercialPlan, term: SubscriptionTerm, offers: readonly SubscriptionOfferView[]): SubscriptionOfferView | undefined {
  const matches = offers.filter(offer => offer.persona === plan.persona && offer.package === plan.package && offer.term === term && matchesCommercialOffer(offer));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Immutable historic order reconstruction only; new selections always use the current catalog. */
export function commercialPlanForRevision(persona: SubscriptionPersona, pack: SubscriptionPackage, revision: string): CommercialPlan | null {
  if (revision !== commercialCatalogRevision && revision !== legacyCommercialCatalogRevision) return null;
  const plan = commercialPlan(persona, pack);
  if (!plan) return null;
  return revision === legacyCommercialCatalogRevision && persona === "level_3" && pack === "basic"
    ? { ...plan, monthlyBaisa: 75000 } : plan;
}

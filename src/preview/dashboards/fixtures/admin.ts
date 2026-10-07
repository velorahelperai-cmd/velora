import type { AdminFixture, UiScenario } from "./types";
import { PREVIEW_FIXTURE_MARK } from "./types";

export const ADMIN_SCENARIOS: Record<UiScenario, AdminFixture> = {
  active: {
    mark: PREVIEW_FIXTURE_MARK,
    scenario: "active",
    accounts: {
      total: 128,
      rows: [
        { id: "a1", email: "owner-a@preview.local", companyHint: "شركة معاينة أ" },
        { id: "a2", email: "owner-b@preview.local", companyHint: "شركة معاينة ب" },
        { id: "a3", email: "staff-c@preview.local", companyHint: "شركة معاينة ج" },
      ],
    },
    companies: [
      { id: "c1", name: "شركة معاينة أ", status: "active" },
      { id: "c2", name: "شركة معاينة ب", status: "setup" },
      { id: "c3", name: "شركة معاينة ج", status: "suspended" },
      { id: "c4", name: "شركة معاينة د", status: "expired" },
    ],
    subscriptions: [
      { companyId: "c1", companyName: "شركة معاينة أ", tier: "level_2", status: "active" },
      { companyId: "c2", companyName: "شركة معاينة ب", tier: null, status: "unconfigured" },
      { companyId: "c3", companyName: "شركة معاينة ج", tier: "level_1", status: "suspended" },
      { companyId: "c4", companyName: "شركة معاينة د", tier: "level_3", status: "expired" },
      { companyId: "c5", companyName: "شركة معاينة هـ", tier: "level_2", status: "pending" },
    ],
    pendingPayments: [
      { id: "p1", companyName: "شركة معاينة هـ", purpose: "initial", ageLabel: "منذ 40 دقيقة" },
      { id: "p2", companyName: "شركة معاينة أ", purpose: "renew", ageLabel: "منذ يومين" },
    ],
    duplicateCollections: [
      {
        id: "d1",
        companyName: "شركة معاينة أ",
        reason: "محاولتان ناجحتان لنفس الطلب — للمراجعة اليدوية",
      },
    ],
    activationRequests: [
      { id: "x1", companyName: "شركة معاينة ب", kind: "review", ageLabel: "منذ 3 ساعات" },
      { id: "x2", companyName: "شركة معاينة أ", kind: "whatsapp", ageLabel: "منذ يوم" },
    ],
    faults: [
      { id: "fault1", code: "WEBHOOK_DELAY", detail: "تأخر أحداث مزوّد الدفع", severity: "warn" },
      { id: "fault2", code: "SETTLE_RETRY", detail: "إعادة تسوية معلّقة", severity: "bad" },
    ],
  },
  loading: {
    mark: PREVIEW_FIXTURE_MARK,
    scenario: "loading",
    accounts: { total: null, rows: [] },
    companies: [],
    subscriptions: [],
    pendingPayments: [],
    duplicateCollections: [],
    activationRequests: [],
    faults: [],
  },
  empty: {
    mark: PREVIEW_FIXTURE_MARK,
    scenario: "empty",
    accounts: { total: 0, rows: [] },
    companies: [],
    subscriptions: [],
    pendingPayments: [],
    duplicateCollections: [],
    activationRequests: [],
    faults: [],
  },
  error: {
    mark: PREVIEW_FIXTURE_MARK,
    scenario: "error",
    accounts: { total: null, rows: [] },
    companies: [],
    subscriptions: [],
    pendingPayments: [],
    duplicateCollections: [],
    activationRequests: [],
    faults: [{ id: "fault-e", code: "OVERVIEW_LOAD", detail: "فشل جلب نظرة عامة", severity: "bad" }],
  },
  stale: {
    mark: PREVIEW_FIXTURE_MARK,
    scenario: "stale",
    accounts: {
      total: 90,
      rows: [{ id: "a1", email: "stale@preview.local", companyHint: "لقطة قديمة" }],
    },
    companies: [{ id: "c1", name: "شركة معاينة أ", status: "active" }],
    subscriptions: [
      { companyId: "c1", companyName: "شركة معاينة أ", tier: "level_2", status: "active" },
    ],
    pendingPayments: [
      { id: "p1", companyName: "شركة معاينة أ", purpose: "renew", ageLabel: "عمر غير مؤكد" },
    ],
    duplicateCollections: [],
    activationRequests: [],
    faults: [
      { id: "fault-s", code: "STALE_SNAPSHOT", detail: "آخر مزامنة فشلت — اعرض بحذر", severity: "warn" },
    ],
  },
  unconfigured: {
    mark: PREVIEW_FIXTURE_MARK,
    scenario: "unconfigured",
    accounts: {
      total: 12,
      rows: [{ id: "a1", email: "early@preview.local", companyHint: "قبل الفوترة" }],
    },
    companies: [{ id: "c1", name: "شركة معاينة مبكرة", status: "setup" }],
    subscriptions: [
      { companyId: "c1", companyName: "شركة معاينة مبكرة", tier: null, status: "unconfigured" },
    ],
    pendingPayments: [],
    duplicateCollections: [],
    activationRequests: [
      { id: "x1", companyName: "شركة معاينة مبكرة", kind: "review", ageLabel: "منذ ساعة" },
    ],
    faults: [
      {
        id: "fault-u",
        code: "BILLING_UNCONFIGURED",
        detail: "مسارات الاشتراك/التحصيل غير مجهّزة للعرض التشغيلي",
        severity: "warn",
      },
    ],
  },
  expired: {
    mark: PREVIEW_FIXTURE_MARK,
    scenario: "expired",
    accounts: {
      total: 40,
      rows: [{ id: "a1", email: "ended@preview.local", companyHint: "انتهى الاشتراك" }],
    },
    companies: [{ id: "c4", name: "شركة معاينة د", status: "expired" }],
    subscriptions: [
      { companyId: "c4", companyName: "شركة معاينة د", tier: "level_3", status: "expired" },
    ],
    pendingPayments: [],
    duplicateCollections: [],
    activationRequests: [],
    faults: [],
  },
  suspended: {
    mark: PREVIEW_FIXTURE_MARK,
    scenario: "suspended",
    accounts: {
      total: 40,
      rows: [{ id: "a1", email: "held@preview.local", companyHint: "تعليق أمني" }],
    },
    companies: [{ id: "c3", name: "شركة معاينة ج", status: "suspended" }],
    subscriptions: [
      { companyId: "c3", companyName: "شركة معاينة ج", tier: "level_1", status: "suspended" },
    ],
    pendingPayments: [],
    duplicateCollections: [],
    activationRequests: [],
    faults: [
      {
        id: "fault-sec",
        code: "SECURITY_HOLD",
        detail: "تعليق أمني — ليس انتهاء دورة",
        severity: "bad",
      },
    ],
  },
};

export const ADMIN_SCENARIO_ORDER: UiScenario[] = [
  "active",
  "loading",
  "empty",
  "error",
  "stale",
  "unconfigured",
  "expired",
  "suspended",
];

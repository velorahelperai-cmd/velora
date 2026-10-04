"use client";

/**
 * Shared preview state for the Velora UI journey (owner + staff) before any backend exists.
 * Persists non-sensitive progress in localStorage. Never stores passwords or sends anything.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type Locale, getDirection, setLocaleCookie } from "@/lib/i18n";
import type { PlanId, SectorId } from "@/lib/landing-copy";

export type Role = "owner" | "staff";
export type SessionStage = "guest" | "unverified" | "active";
export type SourceStatus = "draft" | "processing" | "ready" | "failed";
export type ConversationStatus = "open" | "follow_up" | "handed_over" | "resolved";

export type Account = { name: string; email: string; role: Role };
export type Business = {
  name: string;
  type: SectorId | "other";
  replyLanguage: "ar" | "en" | "both";
  country: string;
  city: string;
  hours: string;
  contactPhone: string;
  contactEmail: string;
};
export type KnowledgeSource = {
  id: string;
  kind: "text" | "file";
  title: string;
  content: string;
  fileName?: string;
  status: SourceStatus;
  updatedAt: number;
};
export type Message = {
  id: string;
  from: "customer" | "assistant" | "staff";
  text: string;
  at: number;
  source?: string;
};
export type Conversation = {
  id: string;
  customer: string;
  phone: string;
  status: ConversationStatus;
  owner: "assistant" | string;
  assistantPaused: boolean;
  summary: string;
  topic: string;
  messages: Message[];
  needsInfo?: string;
};
export type Member = { id: string; name: string; email: string; role: Role; status: "active" | "invited" };
export type Activation = {
  whatsappNumber: string;
  numberOwnership: "own" | "new" | "";
  ready: boolean;
  status: "not_requested" | "pending_review";
  requestedAt?: number;
};

export type DemoState = {
  version: 1;
  stage: SessionStage;
  signedIn: boolean;
  account: Account | null;
  business: Business;
  businessSaved: boolean;
  sources: KnowledgeSource[];
  setupStep: number; // 0..3 current step
  setupDone: boolean[]; // per step
  activation: Activation;
  conversations: Conversation[];
  team: Member[];
  planInterest: PlanId | null;
  testHistory: Message[];
  viewAs: Role; // owner can preview the staff experience
};

const STORAGE_KEY = "velora_preview_v1";

/** Preview-only fields persisted locally. Real auth/company data never goes here. */
type PreviewPersisted = Pick<
  DemoState,
  "version" | "sources" | "conversations" | "team" | "planInterest" | "testHistory" | "activation" | "viewAs"
>;

function toPreviewPersisted(state: DemoState): PreviewPersisted {
  return {
    version: 1,
    sources: state.sources,
    conversations: state.conversations,
    team: state.team,
    planInterest: state.planInterest,
    testHistory: state.testHistory,
    activation: state.activation,
    viewAs: state.viewAs,
  };
}

export const emptyBusiness: Business = {
  name: "",
  type: "restaurant",
  replyLanguage: "both",
  country: "OM",
  city: "",
  hours: "",
  contactPhone: "",
  contactEmail: "",
};

const now = Date.now();
const minutes = (m: number) => now - m * 60_000;

export const sampleConversations: Conversation[] = [
  {
    id: "c1",
    customer: "أحمد",
    phone: "+968 9xxx xx12",
    status: "follow_up",
    owner: "assistant",
    assistantPaused: false,
    topic: "تجهيز مناسبة",
    summary: "عميل يسأل عن تجهيز مناسبة لـ 40 شخصًا يوم الخميس. التفاصيل مؤكدة، بانتظار مسؤول متابعة.",
    messages: [
      { id: "m1", from: "customer", text: "أحتاج أتواصل بخصوص تجهيز مناسبة.", at: minutes(42) },
      { id: "m2", from: "assistant", text: "بكل سرور. كم عدد الضيوف، وما التاريخ المناسب؟", at: minutes(41), source: "سياسة الطلبات الكبيرة" },
      { id: "m3", from: "customer", text: "40 شخصًا، الخميس القادم.", at: minutes(39) },
      { id: "m4", from: "assistant", text: "سجّلت التفاصيل، وسيتواصل معك أحد الفريق لتأكيد التجهيز.", at: minutes(38) },
    ],
  },
  {
    id: "c2",
    customer: "Sara",
    phone: "+968 9xxx xx77",
    status: "open",
    owner: "assistant",
    assistantPaused: false,
    topic: "طلب جديد",
    summary: "عميل يطلب برجرين. تم فهم الطلب من معلومات النشاط وبانتظار إكمال التفاصيل.",
    messages: [
      { id: "m5", from: "customer", text: "عايز أطلب 2 برجر", at: minutes(20) },
      { id: "m6", from: "assistant", text: "تمام. برجرين. تفضّل الحجم والإضافات؟", at: minutes(20), source: "المنيو والأسعار" },
    ],
  },
  {
    id: "c3",
    customer: "خالد",
    phone: "+968 9xxx xx05",
    status: "handed_over",
    owner: "staff",
    assistantPaused: true,
    topic: "سؤال يحتاج معلومة",
    summary: "عميل يسأل عن توفر خيار نباتي في القائمة. لا توجد معلومة في المعرفة؛ تم التحويل للفريق.",
    needsInfo: "الخيارات النباتية في القائمة",
    messages: [
      { id: "m7", from: "customer", text: "هل عندكم خيارات نباتية؟", at: minutes(9) },
      { id: "m8", from: "assistant", text: "لا تتوفر لدي هذه المعلومة الآن. حوّلت سؤالك لأحد الفريق.", at: minutes(9) },
    ],
  },
];

export const sampleStaff: Member = { id: "u2", name: "مريم", email: "maryam@example.com", role: "staff", status: "invited" };

const initialState: DemoState = {
  version: 1,
  stage: "guest",
  signedIn: false,
  account: null,
  business: emptyBusiness,
  businessSaved: false,
  sources: [],
  setupStep: 0,
  setupDone: [false, false, false, false],
  activation: { whatsappNumber: "", numberOwnership: "", ready: false, status: "not_requested" },
  conversations: sampleConversations,
  team: [],
  planInterest: null,
  testHistory: [],
  viewAs: "owner",
};

type Ctx = {
  state: DemoState;
  hydrated: boolean;
  locale: Locale;
  setLocale: (l: Locale) => void;
  update: (patch: Partial<DemoState> | ((s: DemoState) => Partial<DemoState>)) => void;
  reset: () => void;
  nextPath: () => string;
  effectiveRole: Role;
};

const DemoContext = createContext<Ctx | null>(null);

export function DemoProvider({ children, initialLocale }: { children: React.ReactNode; initialLocale: Locale }) {
  const [state, setState] = useState<DemoState>(initialState);
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [hydrated, setHydrated] = useState(false);
  const skipPersist = useRef(true);

  useEffect(() => {
    // Read persisted preview state after mount (external system → React), outside the effect body itself.
    const frame = window.requestAnimationFrame(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<DemoState>;
          if (parsed.version === 1) {
            setState((s) => ({
              ...s,
              sources: parsed.sources ?? s.sources,
              conversations: parsed.conversations ?? s.conversations,
              team: parsed.team ?? s.team,
              planInterest: parsed.planInterest ?? s.planInterest,
              testHistory: parsed.testHistory ?? s.testHistory,
              activation: parsed.activation ?? s.activation,
              viewAs: parsed.viewAs ?? s.viewAs,
              // Never restore account/business/signedIn/setup from preview storage.
              stage: "guest",
              signedIn: false,
              account: null,
              business: emptyBusiness,
              businessSaved: false,
              setupStep: 0,
              setupDone: [false, false, false, false],
            }));
          }
        }
      } catch {
        /* ignore corrupt storage */
      }
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toPreviewPersisted(state)));
    } catch {
      /* storage unavailable */
    }
  }, [state, hydrated]);

  const update = useCallback<Ctx["update"]>((patch) => {
    setState((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleCookie(l);
    setLocaleState(l);
    document.documentElement.lang = l;
    document.documentElement.dir = getDirection(l);
  }, []);

  const nextPath = useCallback(() => pathFor(state), [state]);

  const value = useMemo<Ctx>(
    () => ({
      state,
      hydrated,
      locale,
      setLocale,
      update,
      reset,
      nextPath,
      effectiveRole: state.account?.role === "staff" ? "staff" : state.viewAs,
    }),
    [state, hydrated, locale, setLocale, update, reset, nextPath],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): Ctx {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used inside DemoProvider");
  return ctx;
}

/** Where a returning user should land, by state. */
export function pathFor(s: DemoState): string {
  if (!s.account) return "/signup";
  if (!s.signedIn) return "/login";
  if (s.stage === "unverified") return "/verify-email";
  if (s.account.role === "owner" && !s.setupDone.every(Boolean) && s.activation.status === "not_requested") return "/setup";
  return "/app";
}

export const uid = () => Math.random().toString(36).slice(2, 9);
export const nowMs = () => Date.now();

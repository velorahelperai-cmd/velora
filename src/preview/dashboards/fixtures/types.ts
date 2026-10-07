/** Synthetic design-preview types. Never imported by production dashboards. */

export const PREVIEW_FIXTURE_MARK = "معاينة تصميم" as const;

export type UiScenario =
  | "active"
  | "loading"
  | "empty"
  | "error"
  | "stale"
  | "unconfigured"
  | "expired"
  | "suspended";

/** Neutral tier ids — not commercial names or prices. */
export type NeutralTierId = "level_1" | "level_2" | "level_3";

export type PreviewTone = "ok" | "warn" | "bad" | "muted" | "info";

export type ClientFixture = {
  mark: typeof PREVIEW_FIXTURE_MARK;
  scenario: UiScenario;
  companyLabel: string;
  ownerDisplayName: string;
  /** Single product; one of three alternative levels. */
  productCode: "velora_ai_staff";
  activeTier: NeutralTierId | null;
  availableTiers: NeutralTierId[];
  periodLabel: string | null;
  periodEndsAt: string | null;
  usage: { used: number | null; unit: string; noteKey: "neutral" } | null;
  whatsapp: { tone: PreviewTone; detail: string };
  knowledge: { tone: PreviewTone; detail: string };
  followUps: Array<{ id: string; title: string; ageLabel: string }>;
  nextStep: { label: string; dest: string } | null;
  banner?: { tone: PreviewTone; kind: "expired" | "suspended" | "stale" | "error" | "unconfigured" };
};

export type AdminFixture = {
  mark: typeof PREVIEW_FIXTURE_MARK;
  scenario: UiScenario;
  accounts: { total: number | null; rows: Array<{ id: string; email: string; companyHint: string }> };
  companies: Array<{
    id: string;
    name: string;
    status: "setup" | "active" | "suspended" | "expired";
  }>;
  subscriptions: Array<{
    companyId: string;
    companyName: string;
    tier: NeutralTierId | null;
    status: "active" | "expired" | "suspended" | "unconfigured" | "pending";
  }>;
  pendingPayments: Array<{
    id: string;
    companyName: string;
    purpose: "initial" | "renew";
    ageLabel: string;
  }>;
  duplicateCollections: Array<{
    id: string;
    companyName: string;
    reason: string;
  }>;
  activationRequests: Array<{
    id: string;
    companyName: string;
    kind: "whatsapp" | "review";
    ageLabel: string;
  }>;
  faults: Array<{
    id: string;
    code: string;
    detail: string;
    severity: "warn" | "bad";
  }>;
};

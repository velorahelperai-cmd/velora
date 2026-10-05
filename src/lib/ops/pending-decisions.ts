/**
 * Human approvals required before live WhatsApp/AI/billing.
 * Active values stay unset — candidates are not selected by this package.
 */

export const PENDING_DECISIONS = {
  secretBackend: {
    active: "unconfigured" as const,
    candidate: "supabase_vault" as const,
    rejectedFallbacks: ["env_shared_token", "plaintext_customer_table", "browser_storage"] as const,
  },
  paymentProvider: {
    active: "none" as const,
    recorded: {
      teamOnboardingAfterPayment: true,
      selfServePaysAfterMetaRequirements: true,
    },
    notChosen: ["prices", "grace_period", "refund", "auto_deletion"] as const,
  },
  answerRuntime: {
    active: "none" as const,
    requiredBeforeLive: ["provider", "model", "budget"] as const,
  },
  embeddedSignup: {
    liveOauth: false,
    persistMigration: "20261006020000_vel_wa_embedded_signup_attempts.sql",
    persistApplied: false,
  },
  applyChain: [
    "20261005101500",
    "20261005103000",
    "20261005120000",
    "20261005140000",
    "20261006010000",
    "20261006020000",
  ] as const,
  applySeparateApproval: ["20261005160000"] as const,
  /** Paths exist; live Graph/OAuth/paid complete stay off. */
  metaAiIntegrationReady: true,
  liveMetaAi: false,
  stayOffUntilApplied: [
    "WHATSAPP_ALLOW_EXTERNAL_SEND",
    "live answering",
    "WHATSAPP_EMBEDDED_SIGNUP",
    "WHATSAPP_ROUTING_MODE=tenant_registry",
  ] as const,
} as const;

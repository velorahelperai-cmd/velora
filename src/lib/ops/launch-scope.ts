/**
 * Integration-ready, not live.
 * Meta and AI server paths exist; live Graph/OAuth/paid complete stay off until credentials + apply.
 */

export const LAUNCH_SCOPE = {
  accountCompanyKnowledgeReview: true,
  /** Code paths ready to plug Vault + Embedded Signup + tenant_registry after apply. */
  metaIntegrationReady: true,
  liveWhatsapp: false,
  /** Code paths ready to plug provider/model/budget into getAnswerProvider. */
  aiIntegrationReady: true,
  liveAi: false,
  liveBilling: false,
  applyWhatsappMigrations: false,
  publish: false,
} as const;

export const META_INTEGRATION_HOOKS = [
  "whatsappRoutingMode",
  "resolveWhatsappCompanyByProviderPhone",
  "lookupWhatsappAccessSecret",
  "embeddedSignupClientConfig",
  "createEmbeddedSignupAttempt",
  "replyWhatsappConversation",
] as const;

export const AI_INTEGRATION_HOOKS = [
  "getAnswerProvider",
  "answerRuntimeSetup",
  "askCompanyAnswer",
  "processInboundJobAnswer",
  "runInboundWorkerAnswer",
] as const;

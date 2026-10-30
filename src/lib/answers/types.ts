export type AnswerFailureCode =
  | "NEEDS_SETUP"
  | "NO_KNOWLEDGE"
  | "APPROVAL_INCOMPLETE"
  | "APPROVAL_FOUNDATION_UNAVAILABLE"
  | "CONTEXT_OVERFLOW"
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "UNVERIFIED"
  | "FORBIDDEN"
  | "UNAVAILABLE";

export type AnswerCitation = {
  sourceId: string;
  title: string;
  contentVersion: number;
};

export type AnswerContextChunk = {
  sourceId: string;
  title: string;
  contentVersion: number;
  /** Full excerpt — never silently truncated mid-source. */
  text: string;
  /** Approved source purpose. Business instructions remain lower-trust context. */
  usageRole?: "knowledge" | "business_instructions";
};

export type AnswerPersona = "noura" | "lina" | "dana";

export type AIModelId = "gpt-6-luna" | "gpt-6.1-sol" | "gemini-3.8-flash";
export type AIProviderName = "openai" | "google";

export type AnswerUsage = {
  promptChars: number;
  contextChars: number;
  sourceCount: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  modelId?: AIModelId;
  provider?: AIProviderName;
  estimatedCostBaisa?: number;
  estimatedCostUsd?: number;
  requestId?: string;
  responseId?: string;
  actualModelId?: string;
  latencyMs?: number;
  pricingVersion?: string;
  pricingEffectiveDate?: string;
};

/** Optional attempt evidence; legacy callers remain compatible without these fields. */
export type AnswerAttempt = {
  modelId: AIModelId;
  provider: AIProviderName;
  status: "success" | "failed" | "uncertain" | "not_dispatched";
  usage?: AnswerUsage;
  code?: AnswerFailureCode;
  requestId?: string;
  latencyMs: number;
};

export type AnswerSuccess = {
  ok: true;
  text: string;
  citations: AnswerCitation[];
  usage: AnswerUsage;
  modelId?: AIModelId;
  routingReason?: string;
  attemptsCount?: number;
  attempts?: AnswerAttempt[];
};

export type AnswerFailure = {
  ok: false;
  code: AnswerFailureCode;
  message?: string;
  modelId?: AIModelId;
  provider?: AIProviderName;
  usage?: AnswerUsage;
  requestId?: string;
  latencyMs?: number;
  /** Omitted/false cannot authorize another paid attempt after an uncertain result. */
  retrySafe?: boolean;
  providerAttempted?: boolean;
  attempts?: AnswerAttempt[];
};

export type AnswerResult = AnswerSuccess | AnswerFailure;

export type AnswerProviderRequest = {
  question: string;
  locale: "ar" | "en";
  chunks: AnswerContextChunk[];
  isolationKey?: string | null;
  companyId?: string;
  conversationId?: string;
  forceModelId?: AIModelId;
  dryRun?: boolean;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Fixed display identity, supplied only after server plan verification. */
  persona?: AnswerPersona;
};

export type AnswerProvider = {
  id: string;
  complete(input: AnswerProviderRequest): Promise<AnswerResult>;
  /** Provider-authoritative input token count of the complete request; null when unverifiable. */
  countInputTokens?(input: AnswerProviderRequest): Promise<number | null>;
};

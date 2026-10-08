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
};

export type AIModelId = "gpt-6-luna" | "gpt-6.1-sol" | "gemini-3.8-flash";
export type AIProviderName = "openai" | "google";

export type AnswerUsage = {
  promptChars: number;
  contextChars: number;
  sourceCount: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  modelId?: AIModelId;
  provider?: AIProviderName;
  estimatedCostBaisa?: number;
  estimatedCostUsd?: number;
  requestId?: string;
};

export type AnswerSuccess = {
  ok: true;
  text: string;
  citations: AnswerCitation[];
  usage: AnswerUsage;
  modelId?: AIModelId;
  routingReason?: string;
  attemptsCount?: number;
};

export type AnswerFailure = {
  ok: false;
  code: AnswerFailureCode;
  message?: string;
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
};

export type AnswerProvider = {
  id: string;
  complete(input: AnswerProviderRequest): Promise<AnswerResult>;
};

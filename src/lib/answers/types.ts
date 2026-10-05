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

export type AnswerUsage = {
  promptChars: number;
  contextChars: number;
  sourceCount: number;
};

export type AnswerSuccess = {
  ok: true;
  text: string;
  citations: AnswerCitation[];
  usage: AnswerUsage;
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
  signal?: AbortSignal;
};

export type AnswerProvider = {
  id: string;
  complete(input: AnswerProviderRequest): Promise<AnswerResult>;
};

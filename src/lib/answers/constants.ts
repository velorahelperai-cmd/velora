/**
 * Max characters of knowledge text (titles + body) in one answer context.
 * Character length only — not model tokens and not a spend/budget limit.
 * The full eligible set must fit; overflow yields CONTEXT_OVERFLOW (no silent drop).
 */
export const ANSWER_MAX_CONTEXT_CHARS = 12_000;

/** Max characters for a single user question. */
export const ANSWER_MAX_QUESTION_CHARS = 1_000;

/**
 * Hard cap on number of approved eligible sources per answer context.
 * Exceeding this is CONTEXT_OVERFLOW, not a silent truncation.
 */
export const ANSWER_MAX_SOURCES = 40;

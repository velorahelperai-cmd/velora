/**
 * Answer runtime is not adopted. Do not treat env placeholders as a live provider.
 * Provider, model, and budget must be approved together before wiring getAnswerProvider.
 */

export type AnswerRuntimeSetup = {
  ok: false;
  code: "NEEDS_SETUP";
  provider: null;
  model: null;
  budget: null;
};

export function answerRuntimeSetup(): AnswerRuntimeSetup {
  return {
    ok: false,
    code: "NEEDS_SETUP",
    provider: null,
    model: null,
    budget: null,
  };
}

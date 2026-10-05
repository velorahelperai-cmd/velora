import { describe, expect, it, vi } from "vitest";
import { runAssistantAskAttempt } from "./assistant-tester-outcome";
import type { AnswerResult } from "@/lib/answers/types";

describe("runAssistantAskAttempt exception contract", () => {
  it("forwards successful and failed AnswerResult to onAnswerResult", async () => {
    const onAnswerResult = vi.fn();
    const ok: AnswerResult = {
      ok: true,
      text: "hi",
      citations: [],
      usage: { promptChars: 1, contextChars: 1, sourceCount: 1 },
    };
    await runAssistantAskAttempt({
      ask: async () => ok,
      onAnswerResult,
    });
    expect(onAnswerResult).toHaveBeenCalledWith(ok);

    onAnswerResult.mockClear();
    const fail: AnswerResult = { ok: false, code: "NEEDS_SETUP" };
    await runAssistantAskAttempt({
      ask: async () => fail,
      onAnswerResult,
    });
    expect(onAnswerResult).toHaveBeenCalledWith(fail);
  });

  it("maps thrown ask errors to UNAVAILABLE and still notifies callback once", async () => {
    const onAnswerResult = vi.fn();
    const out = await runAssistantAskAttempt({
      ask: async () => {
        throw new Error("network");
      },
      onAnswerResult,
    });
    expect(out.fromException).toBe(true);
    expect(out.result).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(onAnswerResult).toHaveBeenCalledTimes(1);
    expect(onAnswerResult).toHaveBeenCalledWith({ ok: false, code: "UNAVAILABLE" });
  });

  it("keeps successful ask result when callback throws and does not notify again", async () => {
    const ok: AnswerResult = {
      ok: true,
      text: "kept",
      citations: [],
      usage: { promptChars: 1, contextChars: 1, sourceCount: 1 },
    };
    const onAnswerResult = vi.fn(() => {
      throw new Error("callback boom");
    });
    const out = await runAssistantAskAttempt({
      ask: async () => ok,
      onAnswerResult,
    });
    expect(out.fromException).toBe(false);
    expect(out.result).toEqual(ok);
    expect(onAnswerResult).toHaveBeenCalledTimes(1);
    expect(onAnswerResult).toHaveBeenCalledWith(ok);
  });

  it("keeps returned ask failure when callback throws and does not notify again", async () => {
    const fail: AnswerResult = { ok: false, code: "APPROVAL_INCOMPLETE" };
    const onAnswerResult = vi.fn(() => {
      throw new Error("callback boom");
    });
    const out = await runAssistantAskAttempt({
      ask: async () => fail,
      onAnswerResult,
    });
    expect(out.fromException).toBe(false);
    expect(out.result).toEqual(fail);
    expect(onAnswerResult).toHaveBeenCalledTimes(1);
    expect(onAnswerResult).toHaveBeenCalledWith(fail);
  });
});

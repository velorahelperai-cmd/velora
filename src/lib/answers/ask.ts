"use server";

import {
  ANSWER_MAX_QUESTION_CHARS,
} from "@/lib/answers/constants";
import {
  loadApprovedAnswerContext,
  verifyAnswerCitationsStillValid,
} from "@/lib/answers/context";
import { assertEligibleAnswerChunks, isLiveAnsweringEnabled } from "@/lib/answers/guards";
import { getAnswerProvider } from "@/lib/answers/provider";
import type { AnswerFailureCode, AnswerResult } from "@/lib/answers/types";
import { getCompanyAccess } from "@/lib/tenancy/access";

/**
 * Shared server answer path for the assistant tester (and future live channels).
 * Company identity comes only from the authenticated membership — never from the browser.
 */
export async function askCompanyAnswer(input: {
  question: string;
  locale?: "ar" | "en";
}): Promise<AnswerResult> {
  const question = (input.question ?? "").trim();
  if (!question || question.length > ANSWER_MAX_QUESTION_CHARS) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  try {
    const gate = await assertAnswerCallerAccess();
    if (!gate.ok) return gate;

    const packed = await loadApprovedAnswerContext(gate.companyId);
    if (!packed.ok) {
      return { ok: false, code: packed.code };
    }

    assertEligibleAnswerChunks(packed.chunks);

    const provider = getAnswerProvider();
    // Settings alone do not prove cost limits. Live stays off until provider + budget + usage controls.
    if (!provider || !isLiveAnsweringEnabled()) {
      return { ok: false, code: "NEEDS_SETUP" };
    }

    const locale = input.locale === "en" ? "en" : "ar";
    const result = await provider.complete({
      question,
      locale,
      chunks: packed.chunks,
    });

    if (!result.ok) return result;

    // Re-verify membership, company status, and cited source approval/versions before delivery.
    const again = await assertAnswerCallerAccess();
    if (!again.ok || again.companyId !== gate.companyId) {
      return { ok: false, code: again.ok ? "FORBIDDEN" : again.code };
    }

    const stillValid = await verifyAnswerCitationsStillValid(gate.companyId, packed.chunks);
    if (!stillValid) {
      return { ok: false, code: "UNAVAILABLE" };
    }

    return {
      ok: true,
      text: result.text,
      citations: packed.chunks.map((c) => ({
        sourceId: c.sourceId,
        title: c.title,
        contentVersion: c.contentVersion,
      })),
      usage: {
        promptChars: question.length,
        contextChars: packed.contextChars,
        sourceCount: packed.chunks.length,
      },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

async function assertAnswerCallerAccess(): Promise<
  | { ok: true; companyId: string }
  | { ok: false; code: AnswerFailureCode }
> {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNAUTHENTICATED") return { ok: false, code: "UNAUTHENTICATED" };
    if (access.code === "UNVERIFIED") return { ok: false, code: "UNVERIFIED" };
    if (access.code === "FORBIDDEN") return { ok: false, code: "FORBIDDEN" };
    return { ok: false, code: "UNAVAILABLE" };
  }

  const companyId = access.context.company?.id;
  if (!companyId || !access.context.membership) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (access.context.company?.status === "suspended") {
    return { ok: false, code: "FORBIDDEN" };
  }
  return { ok: true, companyId };
}

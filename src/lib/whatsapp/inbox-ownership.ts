import type { InboxInterventionReason } from "./inbox-contracts";

/** Who may send a manual reply. Automation stopped by a worker is not staff ownership. */
export function staffHandlesConversation(input: {
  status: string;
  intervention?: { reasons: readonly InboxInterventionReason[] };
}): boolean {
  return input.status !== "resolved" && input.intervention?.reasons.includes("human_control") === true;
}

/** Conversation is open for a human claim: automation stopped (or still AI-owned) without a recorded take_over. */
export function conversationNeedsHumanTakeover(input: {
  status: string;
  intervention?: { reasons: readonly InboxInterventionReason[] };
}): boolean {
  return input.status !== "resolved" && !staffHandlesConversation(input);
}

export function manualReplyBlock(input: {
  status: string;
  automationAllowed?: boolean;
  canReply: boolean;
  canTakeOver?: boolean;
  sendLocked: boolean;
  writesPaused: boolean;
  intervention?: { reasons: readonly InboxInterventionReason[] };
}, ar: boolean): string | undefined {
  if (input.writesPaused) {
    return ar
      ? "الاتصال متوقف مؤقتًا. سيُتاح الإرسال بعد التحقق مجددًا."
      : "Connection interrupted. Sending resumes after access is verified again.";
  }
  if (input.sendLocked) {
    return ar
      ? "نتيجة إرسال سابقة غير مؤكدة. تحقق منها قبل أي إرسال جديد."
      : "An earlier send result is unconfirmed. Verify it before sending again.";
  }
  if (input.status === "resolved") {
    return ar ? "المحادثة محلولة. أعد فتحها قبل الرد." : "This conversation is resolved. Reopen it before replying.";
  }
  if (conversationNeedsHumanTakeover(input)) {
    if (input.canTakeOver !== true) {
      return ar
        ? "ليست لديك صلاحية استلام المحادثة. اطلبها من صاحب النشاط، أو اطلب من زميل مخوّل استلامها."
        : "You do not have permission to take over this conversation. Ask the business owner, or ask a permitted teammate to take it over.";
    }
    return input.automationAllowed
      ? (ar ? "فيلورا تدير المحادثة. استلمها أولًا لكتابة ردك." : "Velora is handling this conversation. Take it over before replying.")
      : (ar ? "توقفت الأتمتة دون استلام بشري. استلم المحادثة أولًا للرد اليدوي." : "Automation stopped without a human takeover. Take over the conversation before replying.");
  }
  if (!input.canReply) {
    return ar
      ? "ليست لديك صلاحية الرد على محادثات واتساب. اطلبها من صاحب النشاط."
      : "You do not have permission to reply to WhatsApp conversations. Ask the business owner.";
  }
  return undefined;
}

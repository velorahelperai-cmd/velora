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

/**
 * Take-over is capability `wa.conversations.take_over`.
 * Company owners hold it implicitly with reply; staff need an explicit grant.
 * Owners with reply confirmed must not be blocked by an omitted/stale canTakeOver flag.
 */
export function mayTakeOverConversation(input: {
  canTakeOver?: boolean;
  canReply?: boolean;
  memberRole?: "owner" | "staff";
}): boolean {
  if (input.canTakeOver === true) return true;
  return input.memberRole === "owner" && input.canReply === true;
}

export function manualReplyBlock(input: {
  status: string;
  automationAllowed?: boolean;
  canReply: boolean;
  canTakeOver?: boolean;
  memberRole?: "owner" | "staff";
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
    if (!mayTakeOverConversation(input)) {
      if (input.memberRole === "owner") {
        return ar
          ? "الاستلام والرد متوقفان لهذا النشاط حاليًا (اشتراك أو ربط). راجع الاشتراك والربط في الإعدادات، ثم حدّث الصفحة."
          : "Take-over and reply are paused for this business right now (subscription or connection). Check subscription and connection in Settings, then refresh.";
      }
      return ar
        ? "ليست لديك صلاحية استلام المحادثة (wa.conversations.take_over). اطلب منحها من صاحب النشاط."
        : "You do not have permission to take over this conversation (wa.conversations.take_over). Ask the business owner to grant it.";
    }
    return input.automationAllowed
      ? (ar ? "فيلورا تدير المحادثة. استلمها أولًا لكتابة ردك." : "Velora is handling this conversation. Take it over before replying.")
      : (ar ? "توقفت الأتمتة دون استلام بشري. استلم المحادثة أولًا للرد اليدوي." : "Automation stopped without a human takeover. Take over the conversation before replying.");
  }
  if (!input.canReply) {
    if (input.memberRole === "owner") {
      return ar
        ? "الرد متوقف لهذا النشاط حاليًا (اشتراك أو ربط). راجع الاشتراك والربط في الإعدادات، ثم حدّث الصفحة."
        : "Reply is paused for this business right now (subscription or connection). Check subscription and connection in Settings, then refresh.";
    }
    return ar
      ? "ليست لديك صلاحية الرد على محادثات واتساب (wa.conversations.reply). اطلبها من صاحب النشاط."
      : "You do not have permission to reply to WhatsApp conversations (wa.conversations.reply). Ask the business owner.";
  }
  return undefined;
}

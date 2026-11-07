import { expect, it } from "vitest";
import { conversationNeedsHumanTakeover, manualReplyBlock, mayTakeOverConversation, staffHandlesConversation } from "./inbox-ownership";

const open = { status: "open", automationAllowed: false, canReply: true, canTakeOver: true, sendLocked: false, writesPaused: false };

it("treats only a recorded human takeover as staff handling", () => {
  expect(staffHandlesConversation({ status: "open", intervention: { reasons: ["human_control"] } })).toBe(true);
  expect(staffHandlesConversation({ status: "open", intervention: { reasons: ["worker_failed"] } })).toBe(false);
  expect(staffHandlesConversation({ status: "resolved", intervention: { reasons: ["human_control"] } })).toBe(false);
  expect(staffHandlesConversation({ status: "open" })).toBe(false);
  expect(conversationNeedsHumanTakeover({ status: "handed_over", intervention: { reasons: ["worker_review"] } })).toBe(true);
  expect(conversationNeedsHumanTakeover({ status: "handed_over", intervention: { reasons: ["human_control"] } })).toBe(false);
});

it("lets company owners with reply take over even when the take_over flag is missing or false", () => {
  expect(mayTakeOverConversation({ canTakeOver: false, canReply: true, memberRole: "owner" })).toBe(true);
  expect(mayTakeOverConversation({ canTakeOver: false, canReply: true, memberRole: "staff" })).toBe(false);
  expect(mayTakeOverConversation({ canTakeOver: false, canReply: false, memberRole: "owner" })).toBe(false);
  expect(mayTakeOverConversation({ canTakeOver: true, canReply: false, memberRole: "staff" })).toBe(true);
});

it("explains why a manual reply is unavailable", () => {
  expect(manualReplyBlock({ ...open, intervention: { reasons: ["worker_review"] } }, true)).toContain("استلم المحادثة");
  expect(manualReplyBlock({ ...open, automationAllowed: true, intervention: { reasons: [] } }, false)).toContain("Take it over");
  expect(manualReplyBlock({ ...open, canTakeOver: false, memberRole: "staff", intervention: { reasons: ["worker_review"] } }, true)).toContain("صلاحية استلام");
  expect(manualReplyBlock({ ...open, canTakeOver: false, memberRole: "staff", intervention: { reasons: ["worker_review"] } }, false)).toContain("wa.conversations.take_over");
  expect(manualReplyBlock({ ...open, canTakeOver: false, canReply: false, memberRole: "owner", intervention: { reasons: ["worker_review"] } }, true)).toContain("اشتراك");
  expect(manualReplyBlock({ ...open, canTakeOver: false, canReply: true, memberRole: "owner", intervention: { reasons: ["worker_review"] } }, false)).toContain("Take over the conversation before replying");
  expect(manualReplyBlock({ ...open, intervention: { reasons: ["human_control"] }, canReply: false, memberRole: "staff" }, true)).toContain("صلاحية الرد");
  expect(manualReplyBlock({ ...open, intervention: { reasons: ["human_control"] }, canReply: false, memberRole: "owner" }, false)).toContain("subscription");
  expect(manualReplyBlock({ ...open, intervention: { reasons: ["human_control", "send_unknown"] }, sendLocked: true }, false)).toContain("unconfirmed");
  expect(manualReplyBlock({ ...open, intervention: { reasons: ["human_control"] } }, true)).toBeUndefined();
});

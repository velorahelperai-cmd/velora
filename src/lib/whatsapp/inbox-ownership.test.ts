import { expect, it } from "vitest";
import { manualReplyBlock, staffHandlesConversation } from "./inbox-ownership";

const open = { status: "open", automationAllowed: false, canReply: true, sendLocked: false, writesPaused: false };

it("treats only a recorded human takeover as staff handling", () => {
  expect(staffHandlesConversation({ status: "open", intervention: { reasons: ["human_control"] } })).toBe(true);
  expect(staffHandlesConversation({ status: "open", intervention: { reasons: ["worker_failed"] } })).toBe(false);
  expect(staffHandlesConversation({ status: "resolved", intervention: { reasons: ["human_control"] } })).toBe(false);
  expect(staffHandlesConversation({ status: "open" })).toBe(false);
});

it("explains why a manual reply is unavailable", () => {
  expect(manualReplyBlock({ ...open, intervention: { reasons: ["worker_review"] } }, true)).toContain("استلم المحادثة");
  expect(manualReplyBlock({ ...open, automationAllowed: true, intervention: { reasons: [] } }, false)).toContain("Take it over");
  expect(manualReplyBlock({ ...open, intervention: { reasons: ["human_control"] }, canReply: false }, true)).toContain("صلاحية الرد");
  expect(manualReplyBlock({ ...open, intervention: { reasons: ["human_control", "send_unknown"] }, sendLocked: true }, false)).toContain("unconfirmed");
  expect(manualReplyBlock({ ...open, intervention: { reasons: ["human_control"] } }, true)).toBeUndefined();
});

import { describe, expect, it } from "vitest";
import {
  isStaleConversationRead,
  mergeConversationOverride,
  selectLiveConversations,
} from "./live-inbox";

describe("selectLiveConversations", () => {
  it("returns only server inbox rows and applies overrides by id", () => {
    const inbox = [
      { id: "live-1", topic: "a" },
      { id: "live-2", topic: "b" },
    ];
    const out = selectLiveConversations(inbox, {
      "live-2": { id: "live-2", topic: "b-updated" },
      "demo-x": { id: "demo-x", topic: "should-not-appear" },
    });
    expect(out).toEqual([
      { id: "live-1", topic: "a" },
      { id: "live-2", topic: "b-updated" },
    ]);
    expect(out.some((c) => c.id === "demo-x")).toBe(false);
  });

  it("stays empty when inbox is empty even if demo rows exist elsewhere", () => {
    expect(selectLiveConversations([], { demo: { id: "demo", topic: "x" } })).toEqual([]);
  });

  it("does not let an older local override hide newer server data", () => {
    const out = selectLiveConversations(
      [{ id: "c1", revision: 7, status: "resolved" }],
      { c1: { id: "c1", revision: 5, status: "open" } },
    );
    expect(out).toEqual([{ id: "c1", revision: 7, status: "resolved" }]);
  });

  it("does not let equal control_revision hide a newer server message", () => {
    const out = selectLiveConversations(
      [{
        id: "c1",
        revision: 7,
        status: "open",
        summary: "new ping",
        messages: [
          { at: 1 },
          { at: 20 },
        ],
      }],
      {
        c1: {
          id: "c1",
          revision: 7,
          status: "handed_over",
          summary: "hi",
          messages: [{ at: 1 }],
        },
      },
    );
    expect(out[0].status).toBe("handed_over");
    expect(out[0].revision).toBe(7);
    expect(out[0].messages).toEqual([{ at: 1 }, { at: 20 }]);
    expect(out[0].summary).toBe("new ping");
  });

  it("keeps an override that is at or ahead of the server revision", () => {
    const sameRevision = selectLiveConversations(
      [{ id: "c1", revision: 7, status: "open" }],
      { c1: { id: "c1", revision: 7, status: "handed_over" } },
    );
    expect(sameRevision[0].status).toBe("handed_over");

    const aheadRevision = selectLiveConversations(
      [{ id: "c1", revision: 7, status: "open" }],
      { c1: { id: "c1", revision: 8, status: "resolved" } },
    );
    expect(aheadRevision[0].status).toBe("resolved");
  });

  it("keeps the override when either side has no revision", () => {
    const out = selectLiveConversations(
      [{ id: "c1", status: "open" }],
      { c1: { id: "c1", status: "handed_over" } },
    );
    expect(out[0].status).toBe("handed_over");
  });
});

describe("mergeConversationOverride", () => {
  it("ignores a stale read and keeps the newer stored result", () => {
    const current = { id: "c1", revision: 9, status: "resolved" };
    const stale = { id: "c1", revision: 6, status: "open" };
    expect(mergeConversationOverride(current, stale)).toEqual(current);
  });

  it("adopts a newer read", () => {
    const current = { id: "c1", revision: 6, status: "open" };
    const fresh = { id: "c1", revision: 9, status: "resolved" };
    expect(mergeConversationOverride(current, fresh)).toEqual(fresh);
  });

  it("adopts newer messages from a read that has the same control revision", () => {
    const current = {
      id: "c1",
      revision: 7,
      status: "handed_over",
      summary: "hi",
      messages: [{ at: 1 }],
    };
    const sameRevNewMessage = {
      id: "c1",
      revision: 7,
      status: "open",
      summary: "new ping",
      messages: [{ at: 1 }, { at: 20 }],
    };
    const merged = mergeConversationOverride(current, sameRevNewMessage);
    expect(merged.status).toBe("handed_over");
    expect(merged.revision).toBe(7);
    expect(merged.messages).toEqual([{ at: 1 }, { at: 20 }]);
  });

  it("keeps a newer control result when a same-revision read brings newer messages", () => {
    const current = {
      id: "c1",
      revision: 8,
      status: "resolved",
      summary: "hi",
      messages: [{ at: 1 }],
    };
    const staleControlNewMessage = {
      id: "c1",
      revision: 7,
      status: "open",
      summary: "new ping",
      messages: [{ at: 1 }, { at: 20 }],
    };
    const merged = mergeConversationOverride(current, staleControlNewMessage);
    expect(merged.status).toBe("resolved");
    expect(merged.revision).toBe(8);
    expect(merged.messages).toEqual([{ at: 1 }, { at: 20 }]);
  });

  it("adopts the first read when nothing is stored yet", () => {
    const fresh = { id: "c1", revision: 2 };
    expect(mergeConversationOverride(undefined, fresh)).toBe(fresh);
  });
});

describe("isStaleConversationRead", () => {
  it("compares only when both revisions are numbers", () => {
    expect(isStaleConversationRead({ id: "c", revision: 1 }, { id: "c", revision: 2 })).toBe(true);
    expect(isStaleConversationRead({ id: "c", revision: 2 }, { id: "c", revision: 2 })).toBe(false);
    expect(isStaleConversationRead({ id: "c" }, { id: "c", revision: 2 })).toBe(false);
    expect(isStaleConversationRead({ id: "c", revision: 2 }, undefined)).toBe(false);
  });
});

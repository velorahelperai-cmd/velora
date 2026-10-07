import { describe, expect, it } from "vitest";
import {
  applyInboxSnapshot,
  inboxScopeKey,
  isStaleConversationRead,
  isStaleInboxRefresh,
  isStaleLeadRead,
  mergeConversationOverride,
  selectLiveConversations,
  type InboxSnapshotState,
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

describe("lead revision merge", () => {
  it("keeps newer leadRevision independently of control revision", () => {
    const out = selectLiveConversations(
      [{
        id: "c1",
        revision: 9,
        leadRevision: 2,
        leadStage: "new",
        status: "open",
        messages: [{ at: 1 }],
      }],
      {
        c1: {
          id: "c1",
          revision: 8,
          leadRevision: 4,
          leadStage: "interested",
          status: "handed_over",
          messages: [{ at: 1 }],
        },
      },
    );
    expect(out[0].revision).toBe(9);
    expect(out[0].status).toBe("open");
    expect(out[0].leadRevision).toBe(4);
    expect(out[0].leadStage).toBe("interested");
  });

  it("isStaleLeadRead compares lead revisions only", () => {
    expect(isStaleLeadRead({ id: "c", leadRevision: 1 }, { id: "c", leadRevision: 3 })).toBe(true);
    expect(isStaleLeadRead({ id: "c", leadRevision: 3 }, { id: "c", leadRevision: 3 })).toBe(false);
  });
});

describe("applyInboxSnapshot", () => {
  type Row = {
    id: string;
    revision?: number | null;
    leadRevision?: number | null;
    status?: string;
    leadStage?: string;
    messages?: { at?: number }[];
    summary?: string;
  };
  const scopeA = inboxScopeKey("co-a", "all_company");
  const scopeB = inboxScopeKey("co-b", "all_company");

  it("full snapshot adds new rows into membership", () => {
    const current: InboxSnapshotState<Row> = {
      base: [{ id: "a", revision: 1, messages: [{ at: 1 }] }],
      overrides: {},
      scopeKey: scopeA,
    };
    const next = applyInboxSnapshot(current, {
      kind: "full",
      scopeKey: scopeA,
      conversations: [
        { id: "a", revision: 1, messages: [{ at: 1 }] },
        { id: "b", revision: 1, messages: [{ at: 2 }] },
      ],
    });
    expect(next.base.map((row) => row.id)).toEqual(["a", "b"]);
    expect(selectLiveConversations(next.base, next.overrides).map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("full snapshot removes rows that lost access; partial never removes", () => {
    const current: InboxSnapshotState<Row> = {
      base: [
        { id: "a", revision: 1, messages: [{ at: 1 }] },
        { id: "b", revision: 1, messages: [{ at: 2 }] },
      ],
      overrides: {
        b: { id: "b", revision: 2, status: "handed_over", messages: [{ at: 2 }] },
      },
      scopeKey: scopeA,
    };
    const full = applyInboxSnapshot(current, {
      kind: "full",
      scopeKey: scopeA,
      conversations: [{ id: "a", revision: 1, messages: [{ at: 1 }] }],
    });
    expect(full.base.map((row) => row.id)).toEqual(["a"]);
    expect(full.overrides.b).toBeUndefined();

    const partial = applyInboxSnapshot(current, {
      kind: "partial",
      scopeKey: scopeA,
      conversations: [{ id: "a", revision: 3, status: "resolved", messages: [{ at: 1 }] }],
    });
    expect(partial.base.map((row) => row.id).sort()).toEqual(["a", "b"]);
  });

  it("company/scope switch replaces membership", () => {
    const current: InboxSnapshotState<Row> = {
      base: [{ id: "a", revision: 1, messages: [{ at: 1 }] }],
      overrides: {
        a: { id: "a", revision: 2, status: "handed_over", messages: [{ at: 1 }] },
      },
      scopeKey: scopeA,
    };
    const next = applyInboxSnapshot(current, {
      kind: "full",
      scopeKey: scopeB,
      conversations: [{ id: "z", revision: 1, messages: [{ at: 9 }] }],
    });
    expect(next.scopeKey).toBe(scopeB);
    expect(next.base.map((row) => row.id)).toEqual(["z"]);
    expect(next.overrides).toEqual({});
  });

  it("keeps newer local data for rows still in a full snapshot", () => {
    const current: InboxSnapshotState<Row> = {
      base: [{ id: "a", revision: 5, leadRevision: 3, status: "open", messages: [{ at: 10 }] }],
      overrides: {
        a: {
          id: "a",
          revision: 8,
          leadRevision: 5,
          status: "handed_over",
          leadStage: "interested",
          messages: [{ at: 10 }, { at: 40 }],
        },
      },
      scopeKey: scopeA,
    };
    const late = applyInboxSnapshot(
      current,
      {
        kind: "full",
        scopeKey: scopeA,
        conversations: [
          {
            id: "a",
            revision: 6,
            leadRevision: 2,
            status: "open",
            leadStage: "new",
            messages: [{ at: 10 }],
          },
        ],
      },
      { retainIds: new Set(["a"]) },
    );
    const view = selectLiveConversations(late.base, late.overrides);
    expect(view[0].revision).toBe(8);
    expect(view[0].status).toBe("handed_over");
    expect(view[0].leadRevision).toBe(5);
    expect(view[0].leadStage).toBe("interested");
    expect(view[0].messages).toEqual([{ at: 10 }, { at: 40 }]);
  });

  it("full snapshot drops a revoked row even when retainIds marks a pending op", () => {
    const current: InboxSnapshotState<Row> = {
      base: [
        { id: "a", revision: 1, messages: [{ at: 1 }] },
        { id: "p", revision: 1, messages: [{ at: 2 }] },
      ],
      overrides: {
        p: {
          id: "p",
          revision: 4,
          leadRevision: 3,
          status: "handed_over",
          leadStage: "interested",
          messages: [{ at: 2 }, { at: 9 }],
        },
      },
      scopeKey: scopeA,
    };
    const next = applyInboxSnapshot(
      current,
      {
        kind: "full",
        scopeKey: scopeA,
        conversations: [{ id: "a", revision: 1, messages: [{ at: 1 }] }],
      },
      { retainIds: new Set(["p"]) },
    );
    expect(next.base.map((row) => row.id)).toEqual(["a"]);
    expect(next.overrides.p).toBeUndefined();
    expect(selectLiveConversations(next.base, next.overrides).map((row) => row.id)).toEqual(["a"]);
  });

  it("company switch clears overrides so nothing leaks from A into B", () => {
    const current: InboxSnapshotState<Row> = {
      base: [{ id: "a1", revision: 2, leadRevision: 4, status: "handed_over", messages: [{ at: 1 }] }],
      overrides: {
        a1: {
          id: "a1",
          revision: 9,
          leadRevision: 7,
          status: "resolved",
          leadStage: "interested",
          messages: [{ at: 1 }, { at: 5 }],
        },
      },
      scopeKey: scopeA,
    };
    const next = applyInboxSnapshot(
      current,
      {
        kind: "full",
        scopeKey: scopeB,
        conversations: [{ id: "b1", revision: 1, messages: [{ at: 3 }] }],
      },
      { retainIds: new Set(["a1"]) },
    );
    expect(next.scopeKey).toBe(scopeB);
    expect(next.base.map((row) => row.id)).toEqual(["b1"]);
    expect(next.overrides).toEqual({});
    expect(selectLiveConversations(next.base, next.overrides).map((row) => row.id)).toEqual(["b1"]);
  });

  it("late full reply for company A is ignored after switching to B (no override bleed)", () => {
    const onA: InboxSnapshotState<Row> = {
      base: [{ id: "a1", revision: 2, messages: [{ at: 1 }] }],
      overrides: {
        a1: { id: "a1", revision: 5, status: "handed_over", messages: [{ at: 1 }, { at: 8 }] },
      },
      scopeKey: scopeA,
    };
    const onB = applyInboxSnapshot(onA, {
      kind: "full",
      scopeKey: scopeB,
      conversations: [{ id: "b1", revision: 1, messages: [{ at: 2 }] }],
    });
    // Stale refresh for A must not be applied once active scope is B.
    expect(
      isStaleInboxRefresh({
        requestGen: 1,
        currentGen: 2,
        requestScopeKey: scopeA,
        responseScopeKey: scopeA,
        activeScopeKey: scopeB,
      }),
    ).toBe(true);

    // Even if mistakenly applied via snapshot helper with wrong scope, switch clears A.
    const wronglyMerged = applyInboxSnapshot(onB, {
      kind: "full",
      scopeKey: scopeA,
      conversations: [
        { id: "a1", revision: 1, status: "open", messages: [{ at: 1 }] },
        { id: "a-leak", revision: 1, messages: [{ at: 99 }] },
      ],
    });
    expect(wronglyMerged.scopeKey).toBe(scopeA);
    expect(wronglyMerged.overrides).toEqual({});
    expect(wronglyMerged.base.map((row) => row.id).includes("b1")).toBe(false);
  });

  it("partial within the same scope still upserts without removing siblings", () => {
    const current: InboxSnapshotState<Row> = {
      base: [
        { id: "a", revision: 1, messages: [{ at: 1 }] },
        { id: "b", revision: 1, messages: [{ at: 2 }] },
      ],
      overrides: {},
      scopeKey: scopeA,
    };
    const next = applyInboxSnapshot(current, {
      kind: "partial",
      scopeKey: scopeA,
      conversations: [{ id: "c", revision: 1, messages: [{ at: 3 }] }],
    });
    expect(next.base.map((row) => row.id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("isStaleInboxRefresh", () => {
  const scopeA = inboxScopeKey("co-a", "all_company");
  const scopeB = inboxScopeKey("co-b", "all_company");

  it("rejects when generation advanced (company/scope invalidated pending refresh)", () => {
    expect(
      isStaleInboxRefresh({
        requestGen: 3,
        currentGen: 4,
        requestScopeKey: scopeA,
        responseScopeKey: scopeA,
        activeScopeKey: scopeA,
      }),
    ).toBe(true);
  });

  it("rejects when response company/scope differs from the request or active scope", () => {
    expect(
      isStaleInboxRefresh({
        requestGen: 1,
        currentGen: 1,
        requestScopeKey: scopeA,
        responseScopeKey: scopeB,
        activeScopeKey: scopeB,
      }),
    ).toBe(true);
    expect(
      isStaleInboxRefresh({
        requestGen: 1,
        currentGen: 1,
        requestScopeKey: scopeA,
        responseScopeKey: scopeA,
        activeScopeKey: scopeB,
      }),
    ).toBe(true);
  });

  it("accepts a matching gen + company/scope reply", () => {
    expect(
      isStaleInboxRefresh({
        requestGen: 2,
        currentGen: 2,
        requestScopeKey: scopeA,
        responseScopeKey: scopeA,
        activeScopeKey: scopeA,
      }),
    ).toBe(false);
  });
});

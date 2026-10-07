import { describe, expect, it } from "vitest";
import {
  countLeadWorklist,
  isAwaitingStaffReply,
  isFollowUpOverdue,
  isFollowUpToday,
  matchesLeadWorklist,
  nextLastTouchAt,
  resolveCompanyTimezone,
} from "./leads";

describe("awaiting staff reply", () => {
  it("stays awaiting when only assistant replied after customer", () => {
    expect(
      isAwaitingStaffReply({
        id: "c1",
        status: "open",
        messages: [
          { from: "customer", at: 10 },
          { from: "assistant", at: 20, deliveryState: "delivered" },
        ],
      }),
    ).toBe(true);
  });

  it("clears when staff message is accepted/sent/delivered/read", () => {
    for (const deliveryState of ["accepted", "sent", "delivered", "read"] as const) {
      expect(
        isAwaitingStaffReply({
          id: "c1",
          status: "open",
          messages: [
            { from: "customer", at: 10 },
            { from: "staff", at: 20, deliveryState },
          ],
        }),
      ).toBe(false);
    }
  });

  it("excludes failed staff and re-enters awaiting", () => {
    expect(
      isAwaitingStaffReply({
        id: "c1",
        status: "open",
        messages: [
          { from: "customer", at: 10 },
          { from: "staff", at: 20, deliveryState: "failed" },
        ],
      }),
    ).toBe(true);
  });

  it("does not use last_touch alone — failed after accept leaves awaiting if customer is newer", () => {
    expect(
      isAwaitingStaffReply({
        id: "c1",
        status: "handed_over",
        messages: [
          { from: "customer", at: 30 },
          { from: "staff", at: 20, deliveryState: "failed" },
        ],
      }),
    ).toBe(true);
  });

  it("ignores resolved conversations", () => {
    expect(
      isAwaitingStaffReply({
        id: "c1",
        status: "resolved",
        messages: [{ from: "customer", at: 10 }],
      }),
    ).toBe(false);
  });
});

describe("follow-up lists", () => {
  it("treats only scheduled+date as active; completed keeps history out of overdue", () => {
    const now = Date.parse("2026-10-06T12:00:00.000Z");
    expect(
      isFollowUpOverdue(
        {
          id: "c1",
          status: "open",
          followUpStatus: "scheduled",
          followUpAt: "2026-10-05T10:00:00.000Z",
          messages: [],
        },
        now,
      ),
    ).toBe(true);
    expect(
      isFollowUpOverdue(
        {
          id: "c1",
          status: "open",
          followUpStatus: "completed",
          followUpAt: "2026-10-05T10:00:00.000Z",
          messages: [],
        },
        now,
      ),
    ).toBe(false);
  });

  it("uses IANA day when set and announces UTC when absent", () => {
    const now = Date.parse("2026-10-06T01:30:00.000Z"); // still Oct 5 evening in America/New_York
    const row = {
      id: "c1",
      status: "open" as const,
      followUpStatus: "scheduled" as const,
      followUpAt: "2026-10-05T20:00:00.000Z",
      messages: [],
    };
    expect(resolveCompanyTimezone(null).announcedUtc).toBe(true);
    // follow_up_at Oct 5 UTC vs now Oct 6 UTC → not today in UTC
    expect(isFollowUpToday(row, now, null)).toBe(false);
    expect(isFollowUpToday(row, now, "America/New_York")).toBe(true);
  });

  it("counts conversations not distinct people", () => {
    const now = Date.now();
    const rows = [
      {
        id: "a",
        status: "open",
        leadStage: "trial_or_quote_requested",
        messages: [],
      },
      {
        id: "b",
        status: "open",
        leadStage: "trial_or_quote_requested",
        messages: [],
      },
    ];
    expect(countLeadWorklist(rows, "trial_or_quote", now, null)).toBe(2);
  });

  it("crosses follow-up due time into overdue as nowMs advances (same calendar day stays today)", () => {
    const row = {
      id: "c1",
      status: "open" as const,
      followUpStatus: "scheduled" as const,
      followUpAt: "2026-10-06T12:00:00.000Z",
      messages: [],
    };
    const beforeDue = Date.parse("2026-10-06T11:59:00.000Z");
    const afterDue = Date.parse("2026-10-06T12:00:01.000Z");
    expect(matchesLeadWorklist(row, "follow_up_today", beforeDue, null)).toBe(true);
    expect(matchesLeadWorklist(row, "overdue", beforeDue, null)).toBe(false);
    expect(matchesLeadWorklist(row, "follow_up_today", afterDue, null)).toBe(true);
    expect(matchesLeadWorklist(row, "overdue", afterDue, null)).toBe(true);
    expect(countLeadWorklist([row], "overdue", beforeDue, null)).toBe(0);
    expect(countLeadWorklist([row], "overdue", afterDue, null)).toBe(1);
  });

  it("moves a scheduled follow-up out of today when the calendar day changes", () => {
    const row = {
      id: "c1",
      status: "open" as const,
      followUpStatus: "scheduled" as const,
      followUpAt: "2026-10-06T15:00:00.000Z",
      messages: [],
    };
    const sameDay = Date.parse("2026-10-06T18:00:00.000Z");
    const nextDay = Date.parse("2026-10-07T01:00:00.000Z");
    expect(isFollowUpToday(row, sameDay, null)).toBe(true);
    expect(isFollowUpToday(row, nextDay, null)).toBe(false);
    expect(isFollowUpOverdue(row, nextDay)).toBe(true);
    expect(matchesLeadWorklist(row, "follow_up_today", sameDay, null)).toBe(true);
    expect(matchesLeadWorklist(row, "follow_up_today", nextDay, null)).toBe(false);
    expect(matchesLeadWorklist(row, "overdue", nextDay, null)).toBe(true);
  });
});

describe("last_touch monotonic", () => {
  it("never moves backward on late older event", () => {
    expect(nextLastTouchAt("2026-10-06T12:00:00.000Z", "2026-10-06T11:00:00.000Z")).toBe(
      "2026-10-06T12:00:00.000Z",
    );
    expect(nextLastTouchAt(null, "2026-10-06T11:00:00.000Z")).toBe("2026-10-06T11:00:00.000Z");
    expect(nextLastTouchAt("2026-10-06T10:00:00.000Z", "2026-10-06T11:00:00.000Z")).toBe(
      "2026-10-06T11:00:00.000Z",
    );
  });
});

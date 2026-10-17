import { describe, expect, it } from "vitest";
import {
  classifyCreateOrderWriteAck,
  classifyProvisionWriteAck,
  mapAttemptedWriteDenyCode,
} from "./write-ack";

const order = {
  orderId: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
  accountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
};

describe("es02 attempted-write acknowledgement", () => {
  it("accepts canonical create insert/reuse envelopes", () => {
    expect(classifyCreateOrderWriteAck({ ok: true, action: "insert", data: order })).toEqual({
      status: "success",
      action: "insert",
      data: order,
    });
    expect(classifyCreateOrderWriteAck({ ok: true, action: "reuse", data: order })).toEqual({
      status: "success",
      action: "reuse",
      data: order,
    });
  });

  it.each([null, "<html>upstream lost response</html>", {}, { ok: true, data: null }])(
    "unstructured create reply is unknown: %j",
    (data) => {
      expect(classifyCreateOrderWriteAck(data)).toEqual({ status: "unknown" });
    },
  );

  it.each([
    { ok: "true", action: "insert", data: order },
    { ok: true, action: "unexpected", data: order },
    { ok: false, code: "UNRECOGNIZED_REPLY" },
  ])("contradictory create envelope is unknown: %j", (data) => {
    expect(classifyCreateOrderWriteAck(data)).toEqual({ status: "unknown" });
  });

  it("preserves recognized create denials including FORBIDDEN", () => {
    expect(classifyCreateOrderWriteAck({ ok: false, code: "FORBIDDEN" })).toEqual({
      status: "denied",
      code: "FORBIDDEN",
    });
    expect(classifyCreateOrderWriteAck({ ok: false, code: "OFFER_TAMPER" })).toEqual({
      status: "denied",
      code: "OFFER_TAMPER",
    });
    expect(mapAttemptedWriteDenyCode("UNRECOGNIZED_REPLY")).toBe("UNKNOWN");
  });

  it("rejects nonboolean provision success and requires provisioned|reuse", () => {
    expect(classifyProvisionWriteAck({ ok: "true", action: "provisioned", data: {} })).toEqual({
      status: "unknown",
    });
    expect(classifyProvisionWriteAck({ ok: true, action: "insert", data: {} })).toEqual({
      status: "unknown",
    });
    expect(
      classifyProvisionWriteAck({
        ok: true,
        action: "provisioned",
        data: { companyId: "x" },
      }),
    ).toEqual({
      status: "success",
      action: "provisioned",
      data: { companyId: "x" },
    });
  });
});

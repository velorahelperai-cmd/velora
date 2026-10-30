import { expect, it } from "vitest";
import {
  parseMetaTestReceiveProofScope,
  projectMetaTestReceiveProof,
} from "./whatsapp-meta-test-receive-proof";

const scope = {
  expectedAccountId: "11111111-1111-4111-8111-111111111111",
  companyId: "40d2d885-8b63-49c4-b3da-d2e9566f2750",
  branchId: "a268f9d8-fe5b-41b2-a337-97046a5eaa5c",
};

it("accepts only a complete owned UUID scope", () => {
  expect(parseMetaTestReceiveProofScope(scope)).toEqual(scope);
  expect(parseMetaTestReceiveProofScope({ ...scope, branchId: "not-a-uuid" })).toBeNull();
  expect(parseMetaTestReceiveProofScope(null)).toBeNull();
});

it("projects receive-only inbound rows and ignores automation-enabled conversations", () => {
  const proof = projectMetaTestReceiveProof([
    {
      completed_at: "2026-10-29T19:31:04.986Z",
      message_id: "m1",
      received_at: "2026-10-29T18:41:31.000Z",
      phone_number_id: "1261345677073276",
      direction: "inbound",
      automation_allowed: false,
    },
    {
      completed_at: "2026-10-29T19:02:38.165Z",
      message_id: "m2",
      received_at: "2026-10-29T19:02:33.000Z",
      phone_number_id: "1261345677073276",
      direction: "inbound",
      automation_allowed: false,
    },
    {
      completed_at: "2026-10-29T20:00:00.000Z",
      message_id: "m3",
      received_at: "2026-10-29T20:00:00.000Z",
      phone_number_id: "1261345677073276",
      direction: "inbound",
      automation_allowed: true,
    },
  ]);
  expect(proof).toMatchObject({
    status: "receive_only_success",
    savedMessageCount: 2,
    phoneNumberId: "1261345677073276",
    completedAt: "2026-10-29T19:31:04.986Z",
  });
  expect(proof?.receivedAt).toBe("2026-10-29T18:41:31.000Z");
});

it("returns null without confirmed inbound evidence", () => {
  expect(projectMetaTestReceiveProof([])).toBeNull();
  expect(
    projectMetaTestReceiveProof([
      {
        completed_at: null,
        message_id: "m",
        received_at: null,
        phone_number_id: "1",
        direction: "outbound",
        automation_allowed: false,
      },
    ]),
  ).toBeNull();
});

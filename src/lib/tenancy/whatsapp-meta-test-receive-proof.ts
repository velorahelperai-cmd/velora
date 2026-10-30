/**
 * Presentation contract for authorized Meta test receive-only evidence.
 * Never grants commercial verified, launch eligibility, outbound, or AI reply authority.
 */

export const META_TEST_RECEIVE_ONLY_RESULT = "SETUP_META_TEST_RECEIVE_ONLY" as const;

export type WhatsappMetaTestReceiveProofScope = {
  expectedAccountId: string;
  companyId: string;
  branchId: string;
};

export type WhatsappMetaTestReceiveProof = {
  status: "receive_only_success";
  /** Earliest or latest inbound receipt timestamp from the authoritative job/message pair. */
  receivedAt: string;
  completedAt: string | null;
  savedMessageCount: number;
  /** Meta test phone number id bound to the saved conversation — not a commercial link. */
  phoneNumberId: string | null;
};

export type WhatsappMetaTestReceiveProofRead =
  | { ok: true; scope: WhatsappMetaTestReceiveProofScope; proof: WhatsappMetaTestReceiveProof | null }
  | { ok: false; code: "invalid_input" | "forbidden" | "unavailable" };

export type MetaTestReceiveJobRow = {
  completed_at: string | null;
  message_id: string;
  received_at: string | null;
  phone_number_id: string | null;
  direction: string | null;
  automation_allowed: boolean | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseMetaTestReceiveProofScope(input: unknown): WhatsappMetaTestReceiveProofScope | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const expectedAccountId = typeof value.expectedAccountId === "string" ? value.expectedAccountId : "";
  const companyId = typeof value.companyId === "string" ? value.companyId : "";
  const branchId = typeof value.branchId === "string" ? value.branchId : "";
  if (![expectedAccountId, companyId, branchId].every((id) => UUID.test(id))) return null;
  return { expectedAccountId, companyId, branchId };
}

/** Project durable receive-only rows into a UI-safe proof. Empty when no confirmed rows. */
export function projectMetaTestReceiveProof(rows: readonly MetaTestReceiveJobRow[]): WhatsappMetaTestReceiveProof | null {
  const accepted = rows.filter((row) => {
    if (row.direction !== "inbound") return false;
    if (row.automation_allowed === true) return false;
    const received = typeof row.received_at === "string" ? row.received_at : null;
    const completed = typeof row.completed_at === "string" ? row.completed_at : null;
    const stamp = received ?? completed;
    return !!stamp && Number.isFinite(Date.parse(stamp));
  });
  if (!accepted.length) return null;
  const newest = [...accepted].sort((a, b) => {
    const aTime = Date.parse((a.completed_at ?? a.received_at)!);
    const bTime = Date.parse((b.completed_at ?? b.received_at)!);
    return bTime - aTime;
  })[0]!;
  const receivedAt = newest.received_at ?? newest.completed_at!;
  const completedAt = newest.completed_at && Number.isFinite(Date.parse(newest.completed_at)) ? newest.completed_at : null;
  const phone =
    typeof newest.phone_number_id === "string" && /^\d{5,32}$/.test(newest.phone_number_id)
      ? newest.phone_number_id
      : null;
  return {
    status: "receive_only_success",
    receivedAt: toIso(receivedAt),
    completedAt: completedAt ? toIso(completedAt) : null,
    savedMessageCount: accepted.length,
    phoneNumberId: phone,
  };
}

function toIso(value: string): string {
  if (ISO.test(value)) return value;
  return new Date(value).toISOString();
}

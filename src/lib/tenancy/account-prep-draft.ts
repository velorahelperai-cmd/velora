/** Account-owned unpaid preparation draft contract (DEC-PREP-SERVER-DRAFT-001). */

import type { OnboardingGoal, OnboardingWebsite, OnboardingYesNo } from "@/lib/tenancy/onboarding-answers";
import { createPreparationBranch, type Preparation, type PreparationBranch } from "@/lib/tenancy/prepayment-preparation";

export const ACCOUNT_PREP_DRAFT_PAYLOAD_KEYS = [
  "name",
  "website",
  "country",
  "city",
  "phone",
  "type",
  "whatsappExisting",
  "goals",
  "branches",
] as const;

export type AccountPrepDraftPayloadKey = (typeof ACCOUNT_PREP_DRAFT_PAYLOAD_KEYS)[number];

export type AccountPrepDraftBranch = {
  name: string;
  city: string;
  contactPhone?: string | null;
};

export type AccountPrepDraftPayload = {
  name?: string;
  website?: OnboardingWebsite | null;
  country?: string;
  city?: string;
  phone?: string;
  type?: string;
  whatsappExisting?: OnboardingYesNo | null;
  goals?: OnboardingGoal[];
  branches?: AccountPrepDraftBranch[];
};

export type AccountPrepDraftRecord = {
  draftId: string;
  accountId: string;
  payload: AccountPrepDraftPayload;
  version: number;
  state: "active" | "linked" | "expired_pending_cleanup" | "cancelled";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type AccountPrepDraftCode =
  | "UNAUTHENTICATED"
  | "UNVERIFIED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "UNAVAILABLE"
  | "DRAFT_EXPIRED";

export type AccountPrepDraftResult<T> = { ok: true; data: T } | { ok: false; code: AccountPrepDraftCode };

export type AccountPrepSaveStatus = "idle" | "pending" | "ok" | "fail";

const GOALS = new Set<string>(["support", "sales", "marketing", "bookings", "orders"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  if (value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

function parseWebsite(raw: unknown): { ok: true; value: OnboardingWebsite | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if (!isRecord(raw)) return { ok: false };
  if (raw.kind === "none") {
    if (Object.keys(raw).some((k) => k !== "kind")) return { ok: false };
    return { ok: true, value: { kind: "none" } };
  }
  if (raw.kind === "url") {
    const value = boundedText(raw.value, 200);
    if (!value || !/^https?:\/\//i.test(value)) return { ok: false };
    if (Object.keys(raw).some((k) => k !== "kind" && k !== "value")) return { ok: false };
    return { ok: true, value: { kind: "url", value } };
  }
  return { ok: false };
}

function parseBranches(raw: unknown): { ok: true; value: AccountPrepDraftBranch[] } | { ok: false } {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) return { ok: false };
  const branches: AccountPrepDraftBranch[] = [];
  for (const row of raw) {
    if (!isRecord(row)) return { ok: false };
    if (Object.keys(row).some((k) => k !== "name" && k !== "city" && k !== "contactPhone")) return { ok: false };
    const name = boundedText(row.name, 120);
    const city = boundedText(row.city, 120);
    if (name === null || city === null) return { ok: false };
    let contactPhone: string | null | undefined;
    if ("contactPhone" in row) {
      if (row.contactPhone === null) contactPhone = null;
      else {
        const phone = boundedText(row.contactPhone, 40);
        if (phone === null) return { ok: false };
        contactPhone = phone;
      }
    }
    branches.push(contactPhone === undefined ? { name, city } : { name, city, contactPhone });
  }
  return { ok: true, value: branches };
}

/** Validates a partial patch. Unknown keys fail closed. */
export function parseAccountPrepDraftPatch(raw: unknown): { ok: true; value: AccountPrepDraftPayload } | { ok: false; code: "INVALID_INPUT" } {
  if (!isRecord(raw)) return { ok: false, code: "INVALID_INPUT" };
  const keys = Object.keys(raw);
  if (keys.some((k) => !(ACCOUNT_PREP_DRAFT_PAYLOAD_KEYS as readonly string[]).includes(k))) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const out: AccountPrepDraftPayload = {};
  if ("name" in raw) {
    const name = boundedText(raw.name, 120);
    if (name === null) return { ok: false, code: "INVALID_INPUT" };
    out.name = name;
  }
  if ("country" in raw) {
    const country = boundedText(raw.country, 8);
    if (country === null) return { ok: false, code: "INVALID_INPUT" };
    out.country = country;
  }
  if ("city" in raw) {
    const city = boundedText(raw.city, 120);
    if (city === null) return { ok: false, code: "INVALID_INPUT" };
    out.city = city;
  }
  if ("phone" in raw) {
    const phone = boundedText(raw.phone, 40);
    if (phone === null) return { ok: false, code: "INVALID_INPUT" };
    out.phone = phone;
  }
  if ("type" in raw) {
    const type = boundedText(raw.type, 120);
    if (type === null) return { ok: false, code: "INVALID_INPUT" };
    out.type = type;
  }
  if ("whatsappExisting" in raw) {
    if (raw.whatsappExisting === null) out.whatsappExisting = null;
    else if (raw.whatsappExisting === "yes" || raw.whatsappExisting === "no") out.whatsappExisting = raw.whatsappExisting;
    else return { ok: false, code: "INVALID_INPUT" };
  }
  if ("website" in raw) {
    const website = parseWebsite(raw.website);
    if (!website.ok) return { ok: false, code: "INVALID_INPUT" };
    out.website = website.value;
  }
  if ("goals" in raw) {
    if (!Array.isArray(raw.goals) || raw.goals.length > 8) return { ok: false, code: "INVALID_INPUT" };
    const goals: OnboardingGoal[] = [];
    for (const goal of raw.goals) {
      if (typeof goal !== "string" || !GOALS.has(goal)) return { ok: false, code: "INVALID_INPUT" };
      goals.push(goal as OnboardingGoal);
    }
    out.goals = goals;
  }
  if ("branches" in raw) {
    const branches = parseBranches(raw.branches);
    if (!branches.ok) return { ok: false, code: "INVALID_INPUT" };
    out.branches = branches.value;
  }
  return { ok: true, value: out };
}

export function mergeAccountPrepDraftPayload(
  base: AccountPrepDraftPayload,
  patch: AccountPrepDraftPayload,
): AccountPrepDraftPayload {
  return { ...base, ...patch };
}

/** Four calendar months from createdAt (UTC). Visit must not call this to extend retention. */
export function accountPrepExpiresAt(createdAt: Date): Date {
  const year = createdAt.getUTCFullYear();
  const month = createdAt.getUTCMonth() + 4;
  const day = createdAt.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return new Date(Date.UTC(
    year,
    month,
    clampedDay,
    createdAt.getUTCHours(),
    createdAt.getUTCMinutes(),
    createdAt.getUTCSeconds(),
    createdAt.getUTCMilliseconds(),
  ));
}

export function isAccountPrepUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function accountPrepDraftFromRow(raw: unknown, expectedAccountId: string): AccountPrepDraftRecord | null {
  if (!isRecord(raw)) return null;
  if (raw.account_id !== expectedAccountId) return null;
  if (!isAccountPrepUuid(raw.draft_id) || !isAccountPrepUuid(raw.account_id)) return null;
  if (!Number.isSafeInteger(raw.version) || (raw.version as number) < 0) return null;
  if (raw.state !== "active" && raw.state !== "linked" && raw.state !== "expired_pending_cleanup" && raw.state !== "cancelled") {
    return null;
  }
  if (typeof raw.created_at !== "string" || typeof raw.updated_at !== "string" || typeof raw.expires_at !== "string") {
    return null;
  }
  const payload = parseAccountPrepDraftPatch(raw.payload ?? {});
  if (!payload.ok) return null;
  return {
    draftId: raw.draft_id,
    accountId: raw.account_id,
    payload: payload.value,
    version: raw.version as number,
    state: raw.state,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    expiresAt: raw.expires_at,
  };
}

export function preparationToAccountPrepPatch(input: {
  preparation: Preparation;
  website: OnboardingWebsite | null;
  whatsappExisting: OnboardingYesNo | null;
  goals: OnboardingGoal[];
}): AccountPrepDraftPayload {
  const branches: AccountPrepDraftBranch[] = input.preparation.branches.map((row) => {
    const base: AccountPrepDraftBranch = { name: row.name, city: row.city };
    if (row.contactPhone !== undefined) base.contactPhone = row.contactPhone || null;
    return base;
  });
  return {
    name: input.preparation.name,
    website: input.website,
    country: input.preparation.country,
    city: input.preparation.city,
    phone: input.preparation.phone,
    type: input.preparation.type,
    whatsappExisting: input.whatsappExisting,
    goals: input.goals,
    branches,
  };
}

export function accountPrepPayloadToFormState(payload: AccountPrepDraftPayload): {
  preparation: Preparation;
  website: OnboardingWebsite | null;
  whatsappExisting: OnboardingYesNo | null;
  goals: OnboardingGoal[];
} {
  const branches: PreparationBranch[] =
    payload.branches && payload.branches.length
      ? payload.branches.map((row) => {
          const branch = createPreparationBranch();
          branch.name = row.name;
          branch.city = row.city;
          if (row.contactPhone) branch.contactPhone = row.contactPhone;
          return branch;
        })
      : [createPreparationBranch()];
  return {
    preparation: {
      name: payload.name ?? "",
      type: payload.type ?? "",
      phone: payload.phone ?? "",
      country: payload.country ?? "",
      city: payload.city ?? "",
      branches,
      answers: null,
    },
    website: payload.website ?? null,
    whatsappExisting: payload.whatsappExisting ?? null,
    goals: payload.goals ?? [],
  };
}

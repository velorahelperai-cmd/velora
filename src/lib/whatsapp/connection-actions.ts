"use server";

import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, requirePlatformAdmin } from "@/lib/tenancy/access";
import {
  mapWhatsappCompanyLink,
  type WhatsappCompanyLink,
} from "@/lib/whatsapp/connection";

type ActionOk<T> = { ok: true; data: T };
type ActionFail = {
  ok: false;
  code:
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "COMPANY_SUSPENDED"
    | "INVALID_INPUT"
    | "ALREADY_VERIFIED"
    | "INVALID_TRANSITION"
    | "UNAVAILABLE";
  message?: string;
};

function asRecord(value: Json | null | undefined): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapLinkResult(
  data: unknown,
  includeAdmin: boolean,
): ActionOk<WhatsappCompanyLink> | ActionFail {
  const row = asRecord(data as Json);
  if (!row) return { ok: false, code: "UNAVAILABLE" };
  if (row.ok !== true) {
    const code = String(row.code ?? "");
    if (code === "unauthenticated") return { ok: false, code: "UNAUTHENTICATED" };
    if (code === "forbidden") return { ok: false, code: "FORBIDDEN" };
    if (code === "company_suspended") return { ok: false, code: "COMPANY_SUSPENDED" };
    if (code === "invalid_input") return { ok: false, code: "INVALID_INPUT" };
    if (code === "already_verified") return { ok: false, code: "ALREADY_VERIFIED" };
    if (code === "invalid_transition") return { ok: false, code: "INVALID_TRANSITION" };
    return { ok: false, code: "UNAVAILABLE", message: code || undefined };
  }
  const linkRaw = asRecord(row.link as Json);
  if (!linkRaw) return { ok: false, code: "UNAVAILABLE" };
  const link = mapWhatsappCompanyLink(linkRaw, { includeAdmin });
  if (!link) return { ok: false, code: "UNAVAILABLE" };
  return { ok: true, data: link };
}

/** Member/owner: load current company WhatsApp link snapshot (no secrets). */
export async function getWhatsappCompanyLink(): Promise<ActionOk<WhatsappCompanyLink> | ActionFail> {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNAUTHENTICATED" || access.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (access.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE" };
    return { ok: false, code: "FORBIDDEN" };
  }
  if (!access.context.company || !access.context.membership) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (access.context.company.status === "suspended") {
    return { ok: false, code: "COMPANY_SUSPENDED" };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_whatsapp_company_link");
    if (error) return { ok: false, code: "UNAVAILABLE", message: error.message };
    return mapLinkResult(data, false);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/**
 * Owner: save provisioning request for the business number.
 * Does not connect WhatsApp, activate AI, or complete Meta OAuth.
 */
export async function saveWhatsappLinkRequest(input: {
  requestedDisplayNumber: string;
  keepOnPhone: boolean;
}): Promise<ActionOk<WhatsappCompanyLink> | ActionFail> {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNAUTHENTICATED" || access.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    return { ok: false, code: "FORBIDDEN" };
  }
  if (!access.context.company || !access.context.membership) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (access.context.membership.role !== "owner") {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (access.context.company.status === "suspended") {
    return { ok: false, code: "COMPANY_SUSPENDED" };
  }
  const number = input.requestedDisplayNumber.trim().slice(0, 40);
  if (number.length < 5) return { ok: false, code: "INVALID_INPUT" };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("upsert_whatsapp_link_request", {
      p_requested_display_number: number,
      p_keep_on_phone: Boolean(input.keepOnPhone),
    });
    if (error) return { ok: false, code: "UNAVAILABLE", message: error.message };
    return mapLinkResult(data, false);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function adminGetWhatsappCompanyLink(
  companyId: string,
): Promise<ActionOk<WhatsappCompanyLink> | ActionFail> {
  const access = await requirePlatformAdmin();
  if (!access.ok) {
    if (access.code === "UNAUTHENTICATED" || access.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (access.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE" };
    return { ok: false, code: "FORBIDDEN" };
  }
  if (!companyId) return { ok: false, code: "INVALID_INPUT" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_get_whatsapp_company_link", {
      p_company_id: companyId,
    });
    if (error) return { ok: false, code: "UNAVAILABLE", message: error.message };
    return mapLinkResult(data, true);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/** Admin note only — cannot set verified or tested. */
export async function adminUpdateWhatsappLinkNote(input: {
  companyId: string;
  adminNote: string;
}): Promise<ActionOk<WhatsappCompanyLink> | ActionFail> {
  const access = await requirePlatformAdmin();
  if (!access.ok) {
    if (access.code === "UNAUTHENTICATED" || access.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    return { ok: false, code: "FORBIDDEN" };
  }
  if (!input.companyId) return { ok: false, code: "INVALID_INPUT" };
  const note = input.adminNote.trim().slice(0, 2000);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_update_whatsapp_link_note", {
      p_company_id: input.companyId,
      p_admin_note: note,
    });
    if (error) return { ok: false, code: "UNAVAILABLE", message: error.message };
    return mapLinkResult(data, true);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/** request_saved → needs_external_action only. Not verified / not tested. */
export async function adminMarkWhatsappLinkNeedsExternal(
  companyId: string,
): Promise<ActionOk<WhatsappCompanyLink> | ActionFail> {
  const access = await requirePlatformAdmin();
  if (!access.ok) {
    if (access.code === "UNAUTHENTICATED" || access.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    return { ok: false, code: "FORBIDDEN" };
  }
  if (!companyId) return { ok: false, code: "INVALID_INPUT" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_mark_whatsapp_link_needs_external", {
      p_company_id: companyId,
    });
    if (error) return { ok: false, code: "UNAVAILABLE", message: error.message };
    return mapLinkResult(data, true);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

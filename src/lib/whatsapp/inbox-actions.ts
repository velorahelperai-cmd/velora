"use server";
import { loadWhatsappInboxInitialPage } from "./inbox";

export async function refreshWhatsappInboxInitialPage() { return loadWhatsappInboxInitialPage(); }

import { loadWhatsappInboxPage, loadWhatsappThreadPage, loadWhatsappControlAuditPage, loadWhatsappConnectionStatus, markWhatsappThreadRead } from "./inbox-contracts";

export async function refreshWhatsappInboxPage(input: Parameters<typeof loadWhatsappInboxPage>[0]) {
  return loadWhatsappInboxPage(input);
}
export async function refreshWhatsappThreadPage(input: Parameters<typeof loadWhatsappThreadPage>[0]) {
  return loadWhatsappThreadPage(input);
}
export async function refreshWhatsappControlAuditPage(input: Parameters<typeof loadWhatsappControlAuditPage>[0]) {
  return loadWhatsappControlAuditPage(input);
}
export async function refreshWhatsappConnectionStatus(input: Parameters<typeof loadWhatsappConnectionStatus>[0]) {
  return loadWhatsappConnectionStatus(input);
}
/** Call only after rendering the returned latest thread page; the database owns the boundary. */
export async function markWhatsappThreadSeen(input: Parameters<typeof markWhatsappThreadRead>[0]) {
  return markWhatsappThreadRead(input);
}

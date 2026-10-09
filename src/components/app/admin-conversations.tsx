"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button, Notice, useAppCopy } from "@/components/app/ui";
import { fill } from "@/lib/app-copy";
import {
  adminListCompanyConversations,
  type AdminCompanyConversationsView,
} from "@/lib/tenancy/actions";
import { useDemo } from "@/lib/demo-state";

const PAGE_SIZE = 20;
const MSG_PAGE_SIZE = 50;

export function AdminConversationsView({
  initial,
}: {
  initial: AdminCompanyConversationsView;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const [view, setView] = useState(initial);
  /** Select control value — may differ from loaded view until a load succeeds. */
  const [selectPhone, setSelectPhone] = useState<string>(initial.selectedPhoneNumberId ?? "");
  const [offset, setOffset] = useState(initial.offset);
  const [messageOffset, setMessageOffset] = useState(initial.messageOffset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.conversations[0]?.id ?? null,
  );
  const loadGen = useRef(0);

  async function load(nextPhone: string, nextOffset: number, nextMsgOffset: number) {
    const gen = ++loadGen.current;
    setBusy(true);
    setError(null);
    try {
      const result = await adminListCompanyConversations({
        companyId: view.companyId,
        phoneNumberId: nextPhone || null,
        limit: PAGE_SIZE,
        offset: nextOffset,
        messageLimit: MSG_PAGE_SIZE,
        messageOffset: nextMsgOffset,
      });
      if (gen !== loadGen.current) return;
      if (!result.ok) {
        setError(result.message ?? copy.errors.authFailed);
        // Keep prior loaded view + header; revert select to what is actually loaded.
        setSelectPhone(view.selectedPhoneNumberId ?? "");
        return;
      }
      setView(result.data);
      setSelectPhone(result.data.selectedPhoneNumberId ?? "");
      setOffset(result.data.offset);
      setMessageOffset(result.data.messageOffset);
      // Keep the selected conversation across message-page flips when it remains present.
      setSelectedId((prev) => {
        if (prev && result.data.conversations.some((c) => c.id === prev)) return prev;
        return result.data.conversations[0]?.id ?? null;
      });
    } catch {
      if (gen !== loadGen.current) return;
      setError(copy.errors.authFailed);
      setSelectPhone(view.selectedPhoneNumberId ?? "");
    } finally {
      if (gen === loadGen.current) setBusy(false);
    }
  }

  const selected = view.conversations.find((c) => c.id === selectedId) ?? null;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const hasMore = offset + view.conversations.length < view.total;
  const loadedPhone = view.selectedPhoneNumberId;
  const msgPageNumber = Math.floor(messageOffset / MSG_PAGE_SIZE) + 1;
  const msgHasMore = selected
    ? messageOffset + selected.messages.length < selected.messageTotal
    : false;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between pb-3 border-b border-[#D7C1A5]">
        <Link
          href={`/admin/companies/${view.companyId}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#D7C1A5] bg-[#FFFBF5] text-xs font-semibold text-[#6B4932] hover:text-[#18130F] hover:border-[#6B4932] hover:shadow-2xs transition"
        >
          <span>←</span>
          <span>{copy.admin.backToList}</span>
        </Link>
      </div>

      <header className="mt-4 rounded-2xl border border-[#D7C1A5] bg-[#EFE2CF] px-4 py-3">
        <p className="text-xs font-semibold text-[#6B4932]">{copy.admin.conversationsReadonly}</p>
        <p className="mt-1 text-sm">
          <span className="font-medium text-[#6B4932]">{copy.admin.conversationsCompany}: </span>
          <strong className="break-words text-[#18130F]">{view.companyName}</strong>
        </p>
        <p className="mt-1 text-sm" dir="ltr">
          <span className="font-medium text-[#6B4932]">{copy.admin.conversationsNumber}: </span>
          <span className="[font-family:inherit] font-bold text-[#18130F]">{loadedPhone || "—"}</span>
        </p>
        {view.reviewWhatsappNumber ? (
          <p className="mt-1 text-xs text-[#615244]" dir="ltr">
            {copy.admin.conversationsReviewNumber}: {view.reviewWhatsappNumber}
          </p>
        ) : null}
      </header>

      <h1 className="mt-6 text-3xl font-extrabold text-[#18130F]">{copy.admin.conversationsTitle}</h1>
      <p className="mt-2 text-sm text-[#615244]">{copy.admin.conversationsBody}</p>
      <p className="mt-1 text-xs font-medium text-[#615244]">{copy.admin.conversationsPhoneHint}</p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid min-w-[16rem] flex-1 gap-1 text-sm">
          <span className="font-bold text-[#6B4932]">{copy.admin.conversationsPickPhone}</span>
          <select
            value={selectPhone}
            onChange={(e) => {
              const next = e.target.value;
              setSelectPhone(next);
              if (!next) {
                // Clear loaded conversations so A is never shown under an empty/B title.
                void load("", 0, 0);
                return;
              }
              void load(next, 0, 0);
            }}
            className="min-h-11 rounded-xl border border-[#D7C1A5] bg-[#FFFBF5] px-3 text-sm font-medium text-[#18130F] outline-none focus:border-[#6B4932] focus:ring-1 focus:ring-[#6B4932] transition"
          >
            <option value="">{copy.admin.conversationsNeedPhone}</option>
            {view.phoneIdentities.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? <div className="mt-4"><Notice tone="error">{error}</Notice></div> : null}

      {!view.linkProvisioned ? (
        <div className="mt-4"><Notice tone="warn">{copy.admin.conversationsNotProvisioned}</Notice></div>
      ) : !view.sendReceiveVerified ? (
        <div className="mt-4"><Notice tone="info">{copy.admin.conversationsNotVerified}</Notice></div>
      ) : null}

      {!loadedPhone ? (
        <div className="mt-4"><Notice tone="info">{copy.admin.conversationsNeedPhone}</Notice></div>
      ) : !view.conversations.length ? (
        <div className="mt-4"><Notice tone="info">{copy.admin.conversationsNoMessages}</Notice></div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-[280px_1fr]">
          <ul className="grid gap-2">
            {view.conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-start text-sm transition ${
                    selectedId === c.id
                      ? "border-[#6B4932] bg-[#EFE2CF] shadow-2xs"
                      : "border-[#D7C1A5] bg-[#FFFBF5] hover:bg-[#F7F0E5] hover:border-[#6B4932]/40"
                  }`}
                >
                  <strong className="block truncate font-bold text-[#18130F]">{c.customerName || c.customerWaId}</strong>
                  <span className="text-xs [font-family:inherit] font-medium text-[#615244]" dir="ltr">{c.customerWaId}</span>
                </button>
              </li>
            ))}
          </ul>
          <section className="min-h-[20rem] rounded-2xl border border-[#D7C1A5] bg-[#FFFBF5] p-5 shadow-sm">
            {selected ? (
              <>
                <h2 className="font-bold text-lg text-[#18130F]">{selected.customerName || selected.customerWaId}</h2>
                <p className="text-xs [font-family:inherit] font-medium text-[#6B4932]" dir="ltr">{selected.customerWaId}</p>
                <ul className="mt-4 grid gap-2.5">
                  {selected.messages.map((m) => (
                    <li
                      key={m.id}
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                        m.direction === "outbound" || m.sender === "staff" || m.sender === "assistant"
                          ? "ms-auto bg-[#EFE2CF] border border-[#D7C1A5] text-[#18130F]"
                          : "bg-[#F7F0E5] border border-[#D7C1A5] text-[#18130F]"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words leading-relaxed font-medium">{m.body}</p>
                      <p className="mt-1 text-[10px] font-medium text-[#615244]">
                        {m.sender}
                        {m.receivedAt
                          ? ` · ${new Date(m.receivedAt).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB")}`
                          : ""}
                      </p>
                    </li>
                  ))}
                  {!selected.messages.length ? (
                    <li className="text-sm font-medium text-[#615244]">{copy.admin.conversationsNoMessages}</li>
                  ) : null}
                </ul>
                {selected.messageTotal > MSG_PAGE_SIZE ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-[#D7C1A5]">
                    <Button
                      variant="secondary"
                      disabled={busy || messageOffset <= 0}
                      onClick={() => void load(loadedPhone, offset, Math.max(0, messageOffset - MSG_PAGE_SIZE))}
                    >
                      {copy.admin.accountPrev}
                    </Button>
                    <span className="text-xs font-semibold text-[#615244]">
                      {fill(copy.admin.accountPage, { n: msgPageNumber })} · {selected.messageTotal}
                    </span>
                    <Button
                      variant="secondary"
                      disabled={busy || !msgHasMore}
                      onClick={() => void load(loadedPhone, offset, messageOffset + MSG_PAGE_SIZE)}
                    >
                      {copy.admin.accountNext}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm font-medium text-[#615244]">{copy.app.selectConversation}</p>
            )}
          </section>
        </div>
      )}

      {loadedPhone && (offset > 0 || hasMore) ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={busy || offset <= 0}
            onClick={() => void load(loadedPhone, Math.max(0, offset - PAGE_SIZE), 0)}
          >
            {copy.admin.accountPrev}
          </Button>
          <span className="text-xs font-semibold text-[#615244]">{fill(copy.admin.accountPage, { n: pageNumber })}</span>
          <Button
            variant="secondary"
            disabled={busy || !hasMore}
            onClick={() => void load(loadedPhone, offset + PAGE_SIZE, 0)}
          >
            {copy.admin.accountNext}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

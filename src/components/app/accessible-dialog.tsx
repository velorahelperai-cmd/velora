"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native modality makes the background inert and keeps keyboard focus in the dialog. */
export function AccessibleDialog({ children, label, onClose, busy = false }: {
  children: ReactNode; label: string; onClose: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} aria-label={label} aria-modal="true" aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-4 text-inherit backdrop:bg-black/40"
    style={{ overflowY: "auto" }}>
    <div className="flex min-h-full items-center justify-center">{children}</div>
  </dialog>;
}

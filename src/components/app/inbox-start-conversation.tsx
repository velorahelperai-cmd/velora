'use client';

import { useEffect, useRef, useState } from 'react';
import { startWhatsappConversation } from '@/lib/whatsapp/start-conversation';
import styles from './unified-inbox.module.css';

export function InboxStartConversation({ companyId, ar, enabled, onClose, onCreated }: {
  companyId: string; ar: boolean; enabled: boolean; onClose: () => void; onCreated: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const live = useRef(true);
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    live.current = true;
    dialog.current?.showModal();
    return () => { live.current = false; };
  }, []);
  useEffect(() => { if (!enabled) live.current = false; }, [enabled]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || busy) return;
    const digits = recipient.trim().replace(/^\+/, '');
    if (!/^[1-9][0-9]{6,14}$/.test(digits)) { setError('INVALID_INPUT'); return; }
    setBusy(true); setError('');
    let result: Awaited<ReturnType<typeof startWhatsappConversation>>;
    try { result = await startWhatsappConversation({ companyId, recipient: digits }); }
    catch { if (live.current) { setBusy(false); setError('UNAVAILABLE'); } return; }
    if (!live.current) return;
    setBusy(false);
    if (!result.ok) { setError(result.code); return; }
    onCreated(result.conversationId);
  }
  return <dialog ref={dialog} className={styles.startDialog} aria-labelledby="start-conversation-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <h2 id="start-conversation-title">{ar ? 'محادثة واتساب جديدة' : 'New WhatsApp conversation'}</h2>
      <p>{ar ? 'اكتب رقم العميل مع رمز الدولة. إرسال الرسائل الحرة يتاح بعد رسالة واردة حديثة من العميل.' : 'Enter the customer number with its country code. Free-form messages are available after a recent incoming message.'}</p>
      <label>{ar ? 'رقم العميل' : 'Customer number'}<input autoFocus dir="ltr" type="tel" inputMode="tel" autoComplete="tel" value={recipient} disabled={busy || !enabled} onChange={event => setRecipient(event.target.value)} placeholder="+96890000000" /></label>
      {error && <p role="alert">{error === 'INVALID_INPUT' ? (ar ? 'أدخل رقمًا صحيحًا مع رمز الدولة، بدون مسافات.' : 'Enter a valid number with its country code and no spaces.') : error === 'CONNECTION_UNAVAILABLE' ? (ar ? 'تعذّر التحقق من رقم واتساب المرتبط. راجع إعدادات الربط.' : 'The connected WhatsApp number could not be verified. Check connection settings.') : (ar ? 'تعذّر إنشاء المحادثة. تحقق من الاتصال والصلاحيات وحاول مجددًا.' : 'Could not start the conversation. Check access and connection, then retry.')}</p>}
      <div className={styles.startDialogActions}><button type="button" disabled={busy} onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</button><button type="submit" disabled={busy || !enabled}>{busy ? (ar ? 'جارٍ الفتح…' : 'Opening…') : (ar ? 'فتح المحادثة' : 'Open conversation')}</button></div>
    </form>
  </dialog>;
}

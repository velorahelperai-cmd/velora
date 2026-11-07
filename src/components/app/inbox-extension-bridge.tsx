'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { readInboxContact, removeUnboundWhatsappFile, runInboxExtension, saveInboxContact } from '@/lib/customer/inbox-extension-actions';
import type { InboxDesktopView } from './inbox-desktop';
import { useInboxMediaEvidence } from './inbox-media-evidence';

type Item = { id: string; kind: 'star' | 'tag' | 'note' | 'file' | 'quick'; body: string | null; removable?: boolean | null };
export type PendingInboxIntent = { id: string; body: string; mime?: string; base64?: string; uploaded?: boolean };
export type PendingInboxIntents = Partial<Record<'tag' | 'note' | 'quick' | 'file', PendingInboxIntent>>;
const isItem = (value: unknown): value is Item => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && ['star', 'tag', 'note', 'file', 'quick'].includes(String(item.kind)) &&
    (typeof item.body === 'string' || item.body === null) &&
    (item.removable === undefined || item.removable === null || typeof item.removable === 'boolean');
};

// Mounted per verified workspace and conversation. Never reuse a response across
// identity/selection changes, and require a successful read before enabling writes.
export function InboxExtensionBridge({ view, ar, render, pendingIntents, onIntentChange }: {
  view: InboxDesktopView; ar: boolean; render: (view: InboxDesktopView) => ReactNode;
  pendingIntents?: PendingInboxIntents;
  onIntentChange?: (kind: 'tag' | 'note' | 'quick' | 'file', intent: PendingInboxIntent | null, expectedId?: string) => void;
}) {
  const binding = view.extension!;
  const { companyId, conversationId, channel, canEdit, paused, revision = 0 } = binding;
  const [items, setItems] = useState<Item[] | null>(null);
  const [previousPaused, setPreviousPaused] = useState(paused);
  const [previousRevision, setPreviousRevision] = useState(revision);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  // Pause must clear loaded extensions. A revision bump (list refresh) must not
  // wipe items back to «جارٍ التحميل…» — refetch in the effect while keeping the last ready view.
  if (previousPaused !== paused) {
    setPreviousPaused(paused);
    if (paused) { setItems(null); setBusy(false); setError(false); }
  }
  if (previousRevision !== revision) {
    setPreviousRevision(revision);
    setBusy(false);
  }
  const [editing, setEditing] = useState(Boolean(pendingIntents?.tag));
  const [text, setText] = useState(pendingIntents?.tag?.body ?? '');
  const [noteText, setNoteText] = useState(pendingIntents?.note?.body ?? '');
  const [quickText, setQuickText] = useState(pendingIntents?.quick?.body ?? '');
  const [version, setVersion] = useState(0);
  const active = useRef(false);
  const request = useRef(0);
  const [reservedTag, setReservedTag] = useState<PendingInboxIntent | null>(pendingIntents?.tag ?? null);
  const [reservedNote, setReservedNote] = useState<PendingInboxIntent | null>(pendingIntents?.note ?? null);
  const [reservedQuick, setReservedQuick] = useState<PendingInboxIntent | null>(pendingIntents?.quick ?? null);
  const [reservedFile, setReservedFile] = useState<PendingInboxIntent | null>(pendingIntents?.file ?? null);
  const [readingFile,setReadingFile]=useState(false),[fileError,setFileError]=useState<'invalid'|'quota'|'in_use'|'unavailable'|null>(null);
  const [contact,setContact]=useState<{email:string;location:string}|null>(null);
  const [contactUnavailable,setContactUnavailable]=useState(false);
  const [contactError,setContactError]=useState(false);
  const [editingContact,setEditingContact]=useState(false);
  const [emailDraft,setEmailDraft]=useState('');
  const [locationDraft,setLocationDraft]=useState('');
  const editingContactRef=useRef(false);
  useEffect(()=>{editingContactRef.current=editingContact;},[editingContact]);
  const reserveTag = (intent: PendingInboxIntent | null) => { setReservedTag(intent); onIntentChange?.('tag', intent); };
  const reserveNote = (intent: PendingInboxIntent | null) => { setReservedNote(intent); onIntentChange?.('note', intent); };
  const reserveQuick = (intent: PendingInboxIntent | null) => { setReservedQuick(intent); onIntentChange?.('quick', intent); };
  const reserveFile = (intent: PendingInboxIntent | null) => { setReservedFile(intent); onIntentChange?.('file', intent); };
  const base = { companyId, conversationId, channel };
  const messages = useInboxMediaEvidence({companyId,conversationId,channel,paused,messages:view.messages,ar,revision:binding.revision});

  useEffect(() => {
    active.current = true;
    const fence = request;
    const current = ++fence.current;
    if (!paused) {
      const withTimeout = <T,>(work: Promise<T>, ms = 20000) => Promise.race([
        work,
        new Promise<never>((_, reject) => { const timer = window.setTimeout(() => reject(new Error('EXTENSION_TIMEOUT')), ms); work.finally(() => window.clearTimeout(timer)); }),
      ]);
      void withTimeout(readInboxContact({ companyId, conversationId, channel })).then(profile => {
        if (!active.current || current !== request.current) return;
        // Missing migration / RPC must soft-fail: never surface a save error or block takeover/send.
        if (!profile.ok) {
          setContact(null); setContactUnavailable(true); setContactError(false); setEditingContact(false);
          return;
        }
        setContact(profile.data); setContactUnavailable(false); setContactError(false);
        if (!editingContactRef.current) { setEmailDraft(profile.data.email); setLocationDraft(profile.data.location); }
      }).catch(() => {
        if (active.current && current === request.current) {
          setContact(null); setContactUnavailable(true); setContactError(false); setEditingContact(false);
        }
      });
      void withTimeout(runInboxExtension({ companyId, conversationId, channel, action: 'list' })).then(result => {
        if (!active.current || current !== request.current) return;
        if (!result.ok || !Array.isArray(result.data) || !result.data.every(isItem)) {
          // Keep a previously ready list; only hang-avoid by surfacing retry when nothing loaded.
          setError(true);
          setItems(current => current);
          return;
        }
        setItems(result.data); setError(false);
      }).catch(() => {
        if (!active.current || current !== request.current) return;
        setError(true);
        setItems(current => current);
      });
    }
    return () => { active.current = false; fence.current++; };
  }, [companyId, conversationId, channel, paused, version, revision]);

  async function mutate(input: Parameters<typeof runInboxExtension>[0]) {
    if (paused || busy || !items) return false;
    const current = request.current;
    setBusy(true); setError(false);
    try {
      const result = await runInboxExtension(input);
      if (!active.current || current !== request.current) return false;
      if (!result.ok) {
        if (result.code !== 'UNAVAILABLE') {
          if (input.action === 'tag') reserveTag(null);
          if (input.action === 'note') reserveNote(null);
          if (input.action === 'quick') reserveQuick(null);
          if (input.action === 'file') reserveFile(null);
        }
        if(input.action==='file')setFileError(result.code==='LIMIT'?'quota':'unavailable');
        // Keep the last ready list visible — never flash «جارٍ التحميل…» on a failed write.
        setError(true); return false;
      }
      if (input.action === 'star' || input.action === 'unstar') view.onStarChanged?.();
      // Optimistic local reconcile where the RPC returns the mutated row; otherwise
      // refetch while retaining the previous list (revision/version effect).
      if (Array.isArray(result.data) && result.data.every(isItem)) {
        setItems(result.data); setError(false);
      } else {
        setVersion(value => value + 1);
      }
      return true;
    } catch {
      if (active.current && current === request.current) { if(input.action==='file')setFileError('unavailable'); setError(true); }
      return false;
    } finally { if (active.current && current === request.current) setBusy(false); }
  }

  const ready = !paused && items !== null && !busy;
  const starred = items?.some(item => item.kind === 'star') ?? false;
  const tags = items?.filter(item => item.kind === 'tag' && item.body) ?? [];
  const instagramNotes = items?.filter(item => item.kind === 'note' && item.body) ?? [];
  const quickReplies = items?.filter(item => item.kind === 'quick' && item.body) ?? [];
  const orphanFiles = channel==='whatsapp' ? items?.filter(item=>item.kind==='file'&&item.removable===true&&item.id!==reservedFile?.id)??[] : [];
  const fileConfirmed=!!reservedFile?.uploaded&&!!items?.some(item=>item.kind==='file'&&item.id===reservedFile.id&&item.body===reservedFile.body);
  const reason = ar ? 'تعذّر التحقق من بيانات المحادثة أو صلاحياتها.' : 'Conversation data or permissions could not be verified.';
  async function saveFile(file: PendingInboxIntent) {
    if(!file.mime||!file.base64||!ready||!canEdit)return;
    setFileError(null);
    const ok=await mutate({...base,action:'file',itemId:file.id,body:file.body,mime:file.mime,base64:file.base64});
    if(ok&&active.current)reserveFile({...file,base64:undefined,uploaded:true});
  }
  async function selectFile(file: File){
    if(!ready||!canEdit||reservedFile||readingFile)return;
    if(file.size<1||file.size>524288||!['image/png','image/jpeg','application/pdf'].includes(file.type)||!/^[\p{L}\p{N}_. -]{1,100}$/u.test(file.name)){
      setFileError('invalid');return;
    }
    setReadingFile(true);setFileError(null);
    try{
      const bytes=new Uint8Array(await file.arrayBuffer());if(!active.current||bytes.length!==file.size)return;
      let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
      const pending={id:crypto.randomUUID(),body:file.name,mime:file.type,base64:btoa(binary),uploaded:false};
      reserveFile(pending);await saveFile(pending);
    }catch{if(active.current)setFileError('unavailable');}finally{if(active.current)setReadingFile(false);}
  }
  async function removeStoredFile(id:string){
    if(!ready||!canEdit)return;
    const current=request.current;setBusy(true);setFileError(null);
    try{
      const result=await removeUnboundWhatsappFile({companyId,conversationId,fileId:id});
      if(!active.current||current!==request.current)return;
      if(!result.ok){
        if(result.code!=='IN_USE'){setItems(null);setError(true);}
        if(reservedFile?.id===id)setFileError(result.code==='IN_USE'?'in_use':'unavailable');else setError(true);
        return;
      }
      onIntentChange?.('file',null,id);setReservedFile(value=>value?.id===id?null:value);
      setItems(null);setVersion(value=>value+1);
    }catch{if(active.current&&current===request.current){if(reservedFile?.id===id)setFileError('unavailable');else setError(true);}}
    finally{if(active.current&&current===request.current)setBusy(false);}
  }
  function removeFile(){if(reservedFile)void removeStoredFile(reservedFile.id);else setFileError(null);}
  const notePanel = <form className="vdi-compose-body" onSubmit={event => {
    event.preventDefault();
    const body = noteText.trim();
    if (!ready || !canEdit || !body || body.length > 2000) return;
    const item = reservedNote ?? { id: crypto.randomUUID(), body };
    if (item.body !== body) return;
    reserveNote(item);
    void mutate({ ...base, action: 'note', itemId: item.id, body: item.body }).then(ok => {
      if (ok && active.current) { reserveNote(null); setNoteText(''); }
    });
  }}>
    <label htmlFor="vdi-instagram-note">{ar ? 'ملاحظة داخلية — لا تُرسل للعميل' : 'Internal note — not sent to the customer'}</label>
    <textarea id="vdi-instagram-note" value={noteText} maxLength={2000} readOnly={!!reservedNote} disabled={!ready || !canEdit} onChange={event => setNoteText(event.target.value)}/>
    {reservedNote && <p role="status">{ar ? 'تحقق من الاتصال ثم أعد حفظ الملاحظة نفسها للتأكد من نتيجتها.' : 'Check the connection, then save the same note again to confirm its result.'}</p>}
    <button className="vdi-send" type="submit" disabled={!ready || !canEdit || !noteText.trim()}>{ar ? 'حفظ الملاحظة' : 'Save note'}</button>
  </form>;
  const tagControls = <>
    {editing && <form onSubmit={event => {
      event.preventDefault();
      const body = text.trim();
      if (!ready || !canEdit || !body || body.length > 32) return;
      const item = reservedTag ?? { id: crypto.randomUUID(), body };
      if (item.body !== body) return;
      reserveTag(item);
      void mutate({ ...base, action: 'tag', itemId: item.id, body: item.body }).then(ok => {
        if (ok && active.current) { reserveTag(null); setText(''); setEditing(false); }
      });
    }}>
      <label>{ar ? 'اسم الوسم' : 'Tag name'} <input value={text} maxLength={32} readOnly={!!reservedTag} disabled={!ready || !canEdit} onChange={event => setText(event.target.value)}/></label>
      {reservedTag && <p role="status">{ar ? 'تحقق من الاتصال ثم أعد حفظ الوسم نفسه للتأكد من نتيجته.' : 'Check the connection, then save the same tag again to confirm its result.'}</p>}
      <button type="submit" className="vdi-small-button" disabled={!ready || !canEdit || !text.trim()}>{ar ? 'حفظ الوسم' : 'Save tag'}</button>
      <button type="button" className="vdi-small-button" onClick={() => setEditing(false)}>{ar ? 'إلغاء' : 'Cancel'}</button>
    </form>}
    {canEdit && tags.map(tag => <button key={tag.id} type="button" className="vdi-small-button" disabled={!ready} onClick={() => void mutate({ ...base, action: 'untag', itemId: tag.id })}>{ar ? 'إزالة الوسم: ' : 'Remove tag: '}{tag.body}</button>)}
    {error && <p role="status">{reason} {!paused && <button type="button" className="vdi-small-button" onClick={() => { setError(false); setItems(null); setVersion(value => value + 1); }}>{ar ? 'إعادة المحاولة' : 'Retry'}</button>}</p>}
  </>;
  const composerBase = channel === 'instagram' && view.composer ? { ...view.composer,
    enabledModes: [...view.composer.enabledModes.filter(mode => mode !== 'note'), 'note' as const],
    disabledModes: [...(view.composer.disabledModes ?? []).filter(mode => mode !== 'note'), ...(!ready || !canEdit ? ['note' as const] : [])],
    modePanels: { ...view.composer.modePanels, note: notePanel },
  } : view.composer;
  const composer = composerBase ? { ...composerBase,
    onSubmit:reservedFile?()=>{if(fileConfirmed&&ready&&!readingFile){const id=reservedFile.id;composerBase.onSubmitAttachment?.(id,()=>{onIntentChange?.('file',null,id);if(active.current)setReservedFile(current=>current?.id===id?null:current);});}}:composerBase.onSubmit,
    attachment:channel==='whatsapp'&&composerBase.onSubmitAttachment?{
      name:reservedFile?.body,pending:readingFile||busy||!!fileError||!!reservedFile&&!fileConfirmed,canRemove:!readingFile&&!busy&&(!reservedFile||ready),
      error:fileError==='invalid'?(ar?'اختر صورة أو PDF صالحًا لا يتجاوز 512 كيلوبايت.':'Choose a valid image or PDF up to 512 KB.'):
        fileError==='quota'?(ar?'وصلت للحد الأقصى للمرفقات غير المرسلة. أزل ملفًا غير مستخدم أولًا.':'The unsent attachment limit is reached. Remove an unused file first.'):
        fileError==='in_use'?(ar?'المرفق مرتبط بطلب إرسال ولا يمكن حذفه.':'This file belongs to a send attempt and cannot be deleted.'):
        fileError?(ar?'تعذّر تجهيز المرفق أو التحقق منه.':'Could not prepare or verify the attachment.'):undefined,
      onSelect:(file:File)=>void selectFile(file),onRemove:()=>void removeFile(),
      onRetry:reservedFile&&!reservedFile.uploaded&&ready?()=>void saveFile(reservedFile):undefined,
    }:undefined,
    quickReplies: {
    items: quickReplies.map(item => ({ id: item.id, text: item.body! })), ready, canEdit,
    value: quickText, reserved: !!reservedQuick, onChange: setQuickText,
    onSave: () => {
      const body = quickText.trim();
      if (!ready || !canEdit || !body || body.length > 250) return;
      const item = reservedQuick ?? { id: crypto.randomUUID(), body };
      if (item.body !== body) return;
      reserveQuick(item);
      void mutate({ ...base, action: 'quick', itemId: item.id, body: item.body }).then(ok => {
        if (ok && active.current) { reserveQuick(null); setQuickText(''); }
      });
    },
    onRemove: (id: string) => { if (ready && canEdit) void mutate({ ...base, action: 'unquick', itemId: id }); },
  } } : undefined;
  const contactReady = !paused && contact !== null && !contactUnavailable;
  const storedEmail = contact?.email ?? '';
  async function saveContact(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!contactReady || !canEdit || busy || contactUnavailable) return;
    const current = request.current;
    setBusy(true); setContactError(false);
    try {
      const result = await saveInboxContact({ ...base, email: emailDraft, location: locationDraft });
      if (!active.current || current !== request.current) return;
      if (!result.ok) { setContactError(true); return; }
      setContact(result.data); setEmailDraft(result.data.email); setLocationDraft(result.data.location); setEditingContact(false);
    } catch { if (active.current && current === request.current) setContactError(true); }
    finally { if (active.current && current === request.current) setBusy(false); }
  }
  const contactUnavailableReason = ar
    ? 'ملف الاتصال غير جاهز لهذه المحادثة (تعذّر التحقق من الخادم). يمكنك متابعة الاستلام والرد إن كانت الصلاحيات تسمح، أو أعد المحاولة بعد التحديث.'
    : 'Contact profile is not ready for this conversation (server could not verify). Take-over and reply can continue if permitted; retry after refresh.';
  const emailAction = {
    id: 'email', label: ar ? 'إيميل' : 'Email', icon: 'mail' as const,
    disabled: contactUnavailable || !contactReady || (!storedEmail && !canEdit) || busy,
    reason: contactUnavailable ? contactUnavailableReason : !contactReady ? reason : !storedEmail && !canEdit ? (ar ? 'لا يوجد بريد محفوظ، والتعديل غير متاح.' : 'No saved email, and editing is unavailable.') : undefined,
    onClick: storedEmail ? () => { window.location.href = `mailto:${storedEmail}`; } : () => { setEditingContact(true); view.onProfileTabChange?.('details'); },
  };
  const contactControls = <div className="vdi-contact-editor">
    {contactUnavailable && <p role="status" className="vdi-muted">{contactUnavailableReason}{' '}<button type="button" className="vdi-small-button" onClick={() => { setContactUnavailable(false); setContactError(false); setVersion(value => value + 1); }}>{ar ? 'إعادة المحاولة' : 'Retry'}</button></p>}
    {!contactUnavailable && (editingContact || contactError) && <form onSubmit={event => void saveContact(event)}>
      <label>{ar ? 'البريد الإلكتروني' : 'Email'} <input type="email" dir="ltr" maxLength={254} value={emailDraft} disabled={!contactReady || !canEdit || busy} onChange={event => setEmailDraft(event.target.value)}/></label>
      <label>{ar ? 'الموقع' : 'Location'} <input maxLength={120} value={locationDraft} disabled={!contactReady || !canEdit || busy} onChange={event => setLocationDraft(event.target.value)}/></label>
      {contactError && <p role="status">{ar ? 'تعذّر حفظ بيانات الاتصال. تحقق من البريد ثم أعد المحاولة.' : 'Contact details could not be saved. Check the email, then try again.'}</p>}
      <button type="submit" className="vdi-small-button" disabled={!contactReady || !canEdit || busy}>{ar ? 'حفظ بيانات الاتصال' : 'Save contact details'}</button>
    </form>}
    {contactReady && canEdit && !editingContact && !contactError && <button type="button" className="vdi-small-button" onClick={() => setEditingContact(true)}>{ar ? 'تعديل البريد والموقع' : 'Edit email and location'}</button>}
  </div>;
  return render({ ...view,
    messages,
    extensionStatus: paused || error ? 'unavailable' : items === null ? 'loading' : 'ready',
    contactControls,
    customer: view.customer ? { ...view.customer, email: storedEmail || view.customer.email, location: contact?.location || view.customer.location, tags: tags.map(tag => ({ id: tag.id, label: tag.body! })),
      quickActions: [emailAction, ...(view.customer.quickActions ?? []).filter(action => action.id !== 'email')],
      note: channel === 'instagram' ? (instagramNotes[0]?.body ? { text: instagramNotes[0].body } : undefined) : view.customer.note } : undefined,
    tagControls,
    customerExtra: <>{view.customerExtra}{channel === 'instagram' && instagramNotes.length > 1 && <div aria-label={ar ? 'الملاحظات السابقة' : 'Previous notes'}>{instagramNotes.slice(1).map(note => <p key={note.id}>{note.body}</p>)}</div>}{canEdit&&orphanFiles.length>0&&<div aria-label={ar?'مرفقات غير مستخدمة':'Unused attachments'}><p>{ar?'مرفقات غير مستخدمة':'Unused attachments'}</p>{orphanFiles.map(file=><button type="button" className="vdi-small-button" key={file.id} disabled={!ready} onClick={()=>void removeStoredFile(file.id)}>{ar?'حذف: ':'Delete: '}{file.body}</button>)}</div>}</>,
    messageExtras: <>{view.messageExtras}{error && <p role="status">{reason} {!paused && <button type="button" className="vdi-small-button" onClick={() => { setError(false); setItems(null); setVersion(value => value + 1); }}>{ar ? 'إعادة المحاولة' : 'Retry'}</button>}</p>}</>,
    addTag: { id: 'tag', label: ar ? 'إضافة وسم' : 'Add tag', icon: 'plus', disabled: !ready || !canEdit, reason, onClick: () => { setEditing(true); view.onProfileTabChange?.('details'); } },
    addNote: channel === 'instagram' && view.composer ? { id: 'note', label: ar ? 'إضافة ملاحظة' : 'Add note', icon: 'plus', disabled: !ready || !canEdit, reason, onClick: () => view.composer?.onModeChange('note') } : view.addNote,
    composer,
    headerActions: [...(view.headerActions ?? []).filter(action => action.id !== 'star'),
      { id: 'star', label: starred ? (ar ? 'إلغاء تمييز المحادثة' : 'Unstar conversation') : (ar ? 'تمييز المحادثة' : 'Star conversation'), icon: 'star', active: starred, disabled: !ready, reason, onClick: () => void mutate({ ...base, action: starred ? 'unstar' : 'star' }) }],
  });
}

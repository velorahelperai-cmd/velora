'use client';
import * as React from 'react';
import './inbox-desktop-reference.css';
import type { CSSProperties, ReactNode } from 'react';
import { InboxExtensionBridge, type PendingInboxIntents } from './inbox-extension-bridge';
export type VdiAction = {
    id: string;
    label: string;
    icon: keyof typeof paths;
    onClick?: () => void;
    disabled?: boolean;
    reason?: string;
    active?: boolean;
    emphasis?: string;
};
export type VdiPerson = {
    name: string;
    initials: string;
    avatarUrl?: string;
    status?: string;
};
export type VdiCustomer = VdiPerson & {
    channel: 'whatsapp' | 'instagram' | 'email';
    badge?: string;
    phone?: string;
    email?: string;
    location?: string;
    quickActions?: VdiAction[];
    tags?: {
        id: string;
        label: string;
        tone?: string;
    }[];
    note?: {
        text: string;
        attribution?: string;
        time?: string;
    };
    assignee?: VdiPerson;
};
export type VdiMessage = {
    id: string;
    direction: 'incoming' | 'outgoing';
    text: ReactNode;
    time: string;
    author?: VdiPerson;
    senderLabel?: string;
    senderKind?: 'assistant' | 'staff';
    delivery?: ReactNode;
    deliveryState?: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown';
    attachment?: ReactNode;
};
type Option = {
    id: string;
    label: string;
    count?: number;
};
export type VdiFollowUp = {
    scheduledAt?: string;
    nativePanel?: ReactNode;
    disabled?: boolean;
    pending?: boolean;
    values: {
        stage: string;
        reason: string;
        status: string;
        at: string;
    };
    stages: Option[];
    onChange?: (patch: Partial<VdiFollowUp['values']>) => void;
    onSave?: () => void;
    timezone?: string;
    error?: string;
    savedMessage?: string;
    complete?: VdiAction;
    cancel?: VdiAction;
};
export type VdiActivity = {
    notice?:ReactNode;
    events: {
        id: string;
        label: string;
        actor?: string;
        at: string;
    }[];
    emptyLabel?: string;
    loadMore?: VdiAction;
    nativePanel?: ReactNode;
};
export type VdiConnection = {
    channel: VdiCustomer['channel'];
    label: string;
    statusLabel?: string;
    receiveReady: boolean | null;
    sendReady: boolean | null;
    details?: VdiAction;
};
export type VdiWorkspace = {
    label: string;
    liveState: 'connected' | 'connecting' | 'offline';
    updatedAt?: string;
    refresh?: VdiAction;
    busy?: boolean;
};
export type VdiWorkflow = {
    statusLabel: string;
    automation: 'allowed' | 'paused' | 'blocked';
    automationLabel: string;
    interventions?: string[];
    primary?: VdiAction;
    close?: VdiAction;
};
export type VdiFilters = {
    worklist: string;
    worklists: Option[];
    channel: string;
    channels: Option[];
    onChannelChange: (id: string) => void;
    onWorklistChange: (id: string) => void;
    stages?: Option[];
    stage?: string;
    onStageChange?: (id: string) => void;
};
export type VdiComposer = {
    mode: 'message' | 'ai' | 'note';
    enabledModes: ('message' | 'ai' | 'note')[];
    disabledModes?: ('message' | 'ai' | 'note')[];
    onModeChange: (mode: VdiComposer['mode']) => void;
    modePanels?: Partial<Record<VdiComposer['mode'], ReactNode>>;
    disabledReason?: string;
    ownershipNotice?: string;
    canSend: boolean;
    pending?: boolean;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onSubmitAttachment?: (attachmentId: string, onAccepted: () => void) => void;
    attachment?: { name?: string; pending: boolean; canRemove: boolean; error?: string; onSelect: (file: File) => void; onRemove: () => void; onRetry?: () => void };
    error?: string;
    tools?: VdiAction[];
    quickReplies?: { items: { id: string; text: string }[]; ready: boolean; canEdit: boolean; value: string; reserved: boolean; onChange: (value: string) => void; onSave: () => void; onRemove: (id: string) => void };
};
export type InboxDesktopView = {
    extension?: { companyId: string; conversationId: string; channel: 'whatsapp' | 'instagram'; canEdit: boolean; paused: boolean; revision?: number };
    extensionStatus?: 'loading' | 'unavailable' | 'ready';
    onStarChanged?: () => void;
    emptyListLabel?:string;
    state: 'ready' | 'loading' | 'unavailable' | 'denied';
    scopeKey: string;
    message?: string;
    onRetry?: () => void;
    retrying?: boolean;
    workspace?: VdiWorkspace;
    notice?: ReactNode;
    customer?: VdiCustomer;
    profileTab?: 'details' | 'followup' | 'activity';
    onProfileTabChange?: (tab: 'details' | 'followup' | 'activity') => void;
    closeDetails?: VdiAction;
    followUp?: VdiFollowUp;
    activity?: VdiActivity;
    addTag?: VdiAction;
    tagControls?: ReactNode;
    addNote?: VdiAction;
    assign?: VdiAction;
    customerExtra?: ReactNode;
    connection?: VdiConnection;
    headerActions?: VdiAction[];
    headerExtras?: ReactNode;
    workflow?: VdiWorkflow;
    automationNotice?: ReactNode;
    loadEarlier?: VdiAction;
    unreadBoundaryLabel?: string;
    messages: VdiMessage[];
    messageExtras?: ReactNode;
    nativeComposer?: ReactNode;
    composer?: VdiComposer;
    newConversation?: VdiAction;
    query: string;
    onQueryChange: (value: string) => void;
    tabs: Option[];
    activeTab: string;
    onTabChange: (value: string) => void;
    filters?: VdiFilters;
    filterExtras?: ReactNode;
    conversations: (VdiPerson & {
        id: string;
        channel: VdiCustomer['channel'];
        time: string;
        subject?: string;
        preview: string;
        meta?: ReactNode;
        unreadCount: number;
    })[];
    selectedId?: string;
    onSelect: (id: string) => void;
    listFooter?: ReactNode;
    loadMore?: VdiAction;
    onTranscriptMount?: (node:HTMLDivElement|null)=>void;
    onTranscriptScroll?: React.UIEventHandler<HTMLDivElement>;
};
const paths = {
    search: <React.Fragment><circle cx={"10.8"} cy={"10.8"} r={"6.7"}/><path d={"m16 16 4.6 4.6"}/></React.Fragment>,
    back: <path d={"m14 6-6 6 6 6"}/>, down: <path d={"m6 9 6 6 6-6"}/>,
    more: <React.Fragment><circle cx={"5"} cy={"12"} r={"1"}/><circle cx={"12"} cy={"12"} r={"1"}/><circle cx={"19"} cy={"12"} r={"1"}/></React.Fragment>,
    star: <path d={"m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"}/>,
    tag: <React.Fragment><path d={"m20 13-7 7-10-10V3h7z"}/><circle cx={"7.3"} cy={"7.3"} r={"1.1"}/></React.Fragment>,
    clock: <React.Fragment><circle cx={"12"} cy={"12"} r={"8"}/><path d={"M12 7v5l3 2"}/></React.Fragment>,
    user: <React.Fragment><circle cx={"10"} cy={"7"} r={"3"}/><path d={"M4 20v-2a6 6 0 0 1 12 0v2m3-14v6m-3-3h6"}/></React.Fragment>,
    mail: <React.Fragment><rect x={"3"} y={"5"} width={"18"} height={"14"} rx={"2"}/><path d={"m3 6 9 7 9-7"}/></React.Fragment>,
    phone: <path d={"m5 3 4 1 1 5-3 2a16 16 0 0 0 6 6l2-3 5 1 1 4c-3 6-9 1-13-3S0 6 5 3z"}/>,
    pin: <React.Fragment><path d={"M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z"}/><circle cx={"12"} cy={"10"} r={"2.3"}/></React.Fragment>,
    crown: <path d={"m3 6 4 4 5-6 5 6 4-4-3 12H6zM6 21h12"}/>, plus: <path d={"M12 5v14M5 12h14"}/>,
    send: <path d={"m21 3-7 18-3-8-8-3zM21 3 11 13"}/>,
    clip: <path d={"m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2"}/>,
    smile: <React.Fragment><circle cx={"12"} cy={"12"} r={"9"}/><path d={"M8 14a4 4 0 0 0 8 0M8 8h.1M16 8h.1"}/></React.Fragment>,
    hash: <path d={"M10 3 7 21M17 3l-3 18M4 8h17M3 16h17"}/>,
    chat: <path d={"M20 16H9l-6 4V5a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2zM7 8h10M7 12h6"}/>,
    sparkles: <path d={"m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"}/>,
    note: <React.Fragment><rect x={"4"} y={"3"} width={"16"} height={"18"} rx={"2"}/><path d={"M8 8h8M8 12h8M8 16h5"}/></React.Fragment>,
    edit: <path d={"m16 3 5 5-11 11-6 1 1-6zM14 5l5 5M11 3H4a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-7"}/>,
    copy: <React.Fragment><rect x={"8"} y={"7"} width={"12"} height={"14"} rx={"2"}/><path d={"M16 7V3H4v14h4"}/></React.Fragment>,
    whatsapp: <React.Fragment><path d={"M4 19 3 22l4-1a9 9 0 1 0-3-2z"}/><path d={"m8 6 2 3-1 2a9 9 0 0 0 4 4l2-1 3 2c-1 3-5 2-8-1s-5-7-2-9z"}/></React.Fragment>,
    instagram: <React.Fragment><rect x={"3"} y={"3"} width={"18"} height={"18"} rx={"5"}/><circle cx={"12"} cy={"12"} r={"4"}/><circle cx={"17"} cy={"7"} r={".7"}/></React.Fragment>,
    refresh: <React.Fragment><path d={"M20 7a9 9 0 1 0 1 7M20 3v5h-5"}/></React.Fragment>,
    play: <path d={"m8 4 12 8-12 8z"}/>, pause: <React.Fragment><path d={"M8 5v14M16 5v14"}/></React.Fragment>, check: <path d={"m4 12 5 5L20 6"}/>, close: <path d={"m6 6 12 12M6 18 18 6"}/>, filter: <path d={"M3 5h18l-7 8v7l-4-2v-5z"}/>, activity: <path d={"M2 12h5l3-8 4 16 3-8h5"}/>,
    shield: <path d={"m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"}/>
};
export function Icon({ name }: {
    name: keyof typeof paths;
}) { return <svg className={"vdi-icon"} viewBox={"0 0 24 24"} aria-hidden={"true"}>{paths[name]}</svg>; }
function Avatar({ person, channel, large = false, small = false }: {
    person: VdiPerson;
    channel?: VdiCustomer["channel"];
    large?: boolean;
    small?: boolean;
}) {
    // eslint-disable-next-line @next/next/no-img-element -- Preserve the reference avatar geometry and native image-error fallback.
    return <span className={`vdi-avatar${large ? ' vdi-avatar-large' : ''}${small ? ' vdi-avatar-small' : ''}`}><span aria-hidden={"true"}>{person.initials}</span>{person.avatarUrl && <img src={person.avatarUrl} alt={""} onError={e => { e.currentTarget.hidden = true; }}/>}{channel && <span className={`vdi-channel vdi-channel-${channel}`} title={channel}><Icon name={channel === 'email' ? 'mail' : channel}/></span>}</span>;
}
function ActionButton({ action, small = false, label = false }: {
    action: VdiAction;
    small?: boolean;
    label?: boolean;
}) {
    return <button type={"button"} className={`${small ? 'vdi-small-button' : 'vdi-icon-button'}${action.active ? ' is-active' : ''}${action.emphasis ? ' vdi-action-' + action.emphasis : ''}`} title={action.disabled ? action.reason || action.label : action.label} aria-label={action.label} aria-pressed={action.active === undefined ? undefined : action.active} disabled={action.disabled || !action.onClick} onClick={action.onClick}><Icon name={action.icon}/>{label && <span>{action.label}</span>}</button>;
}
function ConversationHeaderActions({ view, ar }: { view: InboxDesktopView; ar: boolean }) {
    const actions = view.headerActions ?? [];
    const unavailable = ar ? 'هذا الإجراء غير متاح لهذه المحادثة حاليًا.' : 'This action is currently unavailable for this conversation.';
    const assign = actions.find(action => action.id === 'assign') ?? view.assign ?? {
        id: 'assign', label: ar ? 'تعيين' : 'Assign', icon: 'user' as const, disabled: true, reason: unavailable,
    };
    const followup = actions.find(action => action.id === 'followup') ?? {
        id: 'followup', label: ar ? 'المتابعة' : 'Follow-up', icon: 'clock' as const,
        disabled: !view.followUp || !view.onProfileTabChange, reason: unavailable,
        onClick: () => view.onProfileTabChange?.('followup'),
    };
    const tags = actions.find(action => action.id === 'tag') ?? view.addTag ?? {
        id: 'tag', label: ar ? 'الوسوم' : 'Tags', icon: 'tag' as const, disabled: true,
        reason: ar ? 'إضافة الوسوم غير متاحة حاليًا.' : 'Adding tags is currently unavailable.',
    };
    const star = actions.find(action => action.id === 'star') ?? {
        id: 'star', label: ar ? 'تمييز المحادثة' : 'Star conversation', icon: 'star' as const, disabled: true, reason: unavailable,
    };
    const more = actions.find(action => action.id === 'more');
    const extra = actions.filter(action => !['assign', 'followup', 'tag', 'star', 'more'].includes(action.id));
    return <>
        <ActionButton action={assign} small label/>
        <ActionButton action={followup}/>
        <ActionButton action={tags}/>
        <ActionButton action={star}/>
        {more ? <ActionButton action={more}/> : <details className="vdi-header-more" key={view.selectedId} onKeyDown={event => {
            if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
        }}>
            <summary className="vdi-icon-button" aria-label={ar ? 'المزيد' : 'More'} title={ar ? 'المزيد' : 'More'}><Icon name="more"/></summary>
            <div className="vdi-header-menu" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); }}>
                {view.onProfileTabChange && <button type="button" onClick={() => view.onProfileTabChange?.('details')}><Icon name="user"/>{ar ? 'معلومات العميل' : 'Customer information'}</button>}
                {view.activity && view.onProfileTabChange && <button type="button" onClick={() => view.onProfileTabChange?.('activity')}><Icon name="activity"/>{ar ? 'سجل النشاط' : 'Activity history'}</button>}
                {view.connection?.details && <ActionButton action={view.connection.details} small label/>}
                {view.workspace?.refresh && <ActionButton action={view.workspace.refresh} small label/>}
            </div>
        </details>}
        {extra.map(action => <ActionButton key={action.id} action={action}/>)}
        {view.headerExtras}
    </>;
}
export function FollowUpPanel({ model: m, ar }: {
    model: VdiFollowUp;
    ar: boolean;
}) {
    if (m.nativePanel)
        return <div data-feature={"followup"}>{m.nativePanel}</div>;
    const blocked = m.disabled || m.pending || !m.onSave || !m.onChange;
    const reasonRequired = ['trial_or_quote_requested', 'closed_no_subscribe'].includes(m.values.stage);
    return <form className={"vdi-followup"} data-feature={"followup"} onSubmit={e => {
        e.preventDefault();
        if (!blocked)
            m.onSave?.();
    }}><h3>{ar ? 'المتابعة ومرحلة العميل' : 'Follow-up and lead stage'}</h3><p className={"vdi-muted"}>{ar ? 'تنظيم المتابعة بنفس صلاحيات المحادثة.' : 'Follow-up uses existing conversation permissions.'}</p><label>{ar ? 'مرحلة العميل' : 'Lead stage'}<select aria-label={ar ? 'مرحلة العميل' : 'Lead stage'} value={m.values.stage} disabled={blocked} onChange={e => m.onChange?.({ stage: e.target.value })}>{m.stages.map(o => <option value={o.id} key={o.id}>{o.label}</option>)}</select></label>{reasonRequired && <label>{ar ? 'سبب المرحلة' : 'Stage reason'}<textarea required={true} value={m.values.reason} disabled={blocked} onChange={e => m.onChange?.({ reason: e.target.value })}/></label>}<label>{ar ? 'حالة المتابعة' : 'Follow-up status'}<select aria-label={ar ? 'حالة المتابعة' : 'Follow-up status'} value={m.values.status} disabled={blocked} onChange={e => m.onChange?.({ status: e.target.value })}>{['none', 'scheduled', 'completed', 'cancelled'].map((v, i) => <option value={v} key={v}>{(ar ? ['غير مجدولة', 'مجدولة', 'مكتملة', 'ملغاة'] : ['Not scheduled', 'Scheduled', 'Completed', 'Cancelled'])[i]}</option>)}</select></label><label>{ar ? 'موعد المتابعة' : 'Follow-up time'}<input aria-label={ar ? 'موعد المتابعة' : 'Follow-up time'} type={"datetime-local"} required={m.values.status==='scheduled'} value={m.values.at} disabled={blocked||m.values.status!=='scheduled'} onChange={e => m.onChange?.({ at: e.target.value })}/></label><p className={"vdi-muted"}>{ar ? 'التوقيت: ' : 'Timezone: '}<bdi dir={"ltr"}>{m.timezone}</bdi></p>{m.error && <p role={"alert"} className={"vdi-compose-error"}>{m.error}</p>}{m.savedMessage && <p role={"status"} className={"vdi-success-text"}>{m.savedMessage}</p>}<button className={"vdi-send"} disabled={blocked} type={"submit"}><Icon name={"check"}/>{m.pending ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ المتابعة' : 'Save follow-up')}</button><div className={"vdi-followup-actions"}><ActionButton action={m.complete?{...m.complete,disabled:blocked||m.complete.disabled}:{id:'complete',label:ar?'إكمال المتابعة':'Complete follow-up',icon:'check',disabled:true,reason:ar?'لا توجد متابعة مجدولة لإكمالها.':'There is no scheduled follow-up to complete.'}} small label/><ActionButton action={m.cancel?{...m.cancel,disabled:blocked||m.cancel.disabled}:{id:'cancel',label:ar?'إلغاء المتابعة':'Cancel follow-up',icon:'close',disabled:true,reason:ar?'لا توجد متابعة مجدولة لإلغائها.':'There is no scheduled follow-up to cancel.'}} small label/></div></form>;
}
function ActivityPanel({ model, ar }: {
    model: VdiActivity;
    ar: boolean;
}) {
    if (model.nativePanel)
        return <div data-feature={"activity"}>{model.nativePanel}</div>;
    let _a;
    return <section data-feature={"activity"} className={"vdi-activity"}><h3>{ar ? 'سجل نشاط المحادثة' : 'Conversation activity'}</h3>{model.notice}<ol>{model.events.map(e => <li key={e.id}><span className={"vdi-activity-dot"}/><div><p>{e.label}</p>{e.actor && <small>{e.actor}</small>}<time>{e.at}</time></div></li>)}</ol>{!model.events.length && <p className={"vdi-muted"}>{(_a = model.emptyLabel) !== null && _a !== void 0 ? _a : (ar ? 'لا يوجد نشاط معروض.' : 'No displayed activity.')}</p>}{model.loadMore && <ActionButton action={model.loadMore} small={true} label={true}/>}</section>;
}
function ConnectionPanel({ model: m, ar }: {
    model: VdiConnection;
    ar: boolean;
}) {
    const state = (v: boolean | null) => v === null ? (ar ? 'غير متحقق' : 'Unverified') : v ? (ar ? 'جاهز' : 'Ready') : (ar ? 'غير متاح' : 'Unavailable');
    return <div data-feature={"connection"} className={"vdi-connection"}><div><Icon name={m.channel === 'email' ? 'mail' : m.channel}/><strong>{m.label}{m.statusLabel&&<> · {m.statusLabel}</>}</strong>{m.details && <ActionButton action={m.details}/>}</div><p>{ar ? 'الاستقبال: ' : 'Receive: '}{state(m.receiveReady)}{" \u00B7 "}{ar ? 'الإرسال: ' : 'Send: '}{state(m.sendReady)}</p></div>;
}
function CustomerTeam({view,ar}:{view:InboxDesktopView;ar:boolean}) {
 const person=view.customer?.assignee;
 const followup=view.followUp;
 let appointment=ar?'لا يوجد':'None';
 if(followup?.values.status==='scheduled'){
  const date=followup.scheduledAt?new Date(followup.scheduledAt):null;
  appointment=date&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat(ar?'ar-OM':'en-GB',{timeZone:followup.timezone??'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date):followup.values.at.replace('T',' · ')||appointment;
 }else if(followup?.values.status==='completed')appointment=ar?'مكتملة':'Completed';
 else if(followup?.values.status==='cancelled')appointment=ar?'ملغاة':'Cancelled';
 return <>
  <section className="vdi-section" data-feature="assigned-team"><h3>{ar?'الفريق المسؤول':'Assigned team'}</h3><div className="vdi-team">
   {person?<><Avatar person={person} small/><div><div>{person.name}</div><small>{person.status||(ar?'حالة التواجد غير متاحة':'Presence unavailable')}</small></div></>:<><span className="vdi-avatar vdi-avatar-small" aria-hidden="true"><Icon name="user"/></span><span className="vdi-muted">{ar?'لا يوجد':'None'}</span></>}
   <ActionButton action={view.assign?{...view.assign,icon:'down'}:{id:'assign',label:ar?'تعيين المسؤول':'Assign teammate',icon:'down',disabled:true,reason:ar?'تعيين المسؤول غير متاح بالصلاحيات الحالية.':'Assignment is unavailable with your current permissions.'}}/>
  </div></section>
  <button type="button" className="vdi-followup-summary" data-feature="next-followup" disabled={!followup||!view.onProfileTabChange} title={followup?.timezone} onClick={()=>view.onProfileTabChange?.('followup')}><Icon name="clock"/><span><strong>{ar?'المتابعة القادمة':'Next follow-up'}</strong><small>{appointment}</small></span><Icon name="back"/></button>
 </>;
}
function ClientQuickActions({view,ar}:{view:InboxDesktopView;ar:boolean}) {
 const actions=view.customer?.quickActions??[];
 const reason=ar?'بيانات الاتصال أو صلاحية الإجراء غير متاحة حاليًا.':'Contact details or permission for this action are currently unavailable.';
 const quick=(id:string,icon:VdiAction['icon'],label:string):VdiAction=>actions.find(action=>action.id===id)??{id,icon,label,disabled:true,reason};
 const buttons=[quick('whatsapp','whatsapp',ar?'واتساب':'WhatsApp'),quick('email','mail',ar?'إيميل':'Email'),quick('call','phone',ar?'مكالمة':'Call')];
 const extra=actions.filter(action=>!['whatsapp','email','call','more'].includes(action.id));
 const more=actions.find(action=>action.id==='more');
 return <div className="vdi-quick-actions">
  {buttons.map(action=><button key={action.id} type="button" className="vdi-quick-action" aria-label={action.label} disabled={action.disabled||!action.onClick} title={action.reason??action.label} onClick={action.onClick}><span className="vdi-icon-button"><Icon name={action.icon}/></span><span>{action.id==='call'?(ar?'مكالمة':'Call'):action.id==='email'?(ar?'إيميل':'Email'):action.id==='whatsapp'?(ar?'واتساب':'WhatsApp'):action.label}</span></button>)}
  {more?<button type="button" className="vdi-quick-action" disabled={more.disabled||!more.onClick} title={more.reason} onClick={more.onClick}><span className="vdi-icon-button"><Icon name="more"/></span><span>{ar?'المزيد':'More'}</span></button>:<details className="vdi-customer-more" key={view.selectedId} onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}>
   <summary className="vdi-quick-action" aria-label={ar?'المزيد من إجراءات العميل':'More customer actions'}><span className="vdi-icon-button"><Icon name="more"/></span><span>{ar?'المزيد':'More'}</span></summary>
   <div className="vdi-header-menu" onClick={event=>event.currentTarget.closest('details')?.removeAttribute('open')}>
    {extra.map(action=><ActionButton key={action.id} action={action} small label/>)}
    {view.activity&&view.onProfileTabChange&&<button type="button" onClick={()=>view.onProfileTabChange?.('activity')}><Icon name="activity"/>{ar?'سجل النشاط':'Activity history'}</button>}
    {view.followUp&&view.onProfileTabChange&&<button type="button" onClick={()=>view.onProfileTabChange?.('followup')}><Icon name="clock"/>{ar?'المتابعة':'Follow-up'}</button>}
   </div>
  </details>}
 </div>;
}
function ContactInformation({customer:c,ar}:{customer:VdiCustomer;ar:boolean}) {
 const missing=ar?'لا يوجد':'Not available';
 return <section className="vdi-section" data-feature="contact-information"><h3>{ar?'معلومات الاتصال':'Contact information'}</h3>
  <div className="vdi-contact" title={ar?'رقم الهاتف':'Phone number'}><Icon name="phone"/>{c.phone?.trim()?<bdi dir="ltr">{c.phone}</bdi>:<span>{missing}</span>}</div>
  <div className="vdi-contact" title={ar?'البريد الإلكتروني':'Email'}><Icon name="mail"/>{c.email?.trim()?<bdi dir="ltr">{c.email}</bdi>:<span>{missing}</span>}</div>
  <div className="vdi-contact" title={ar?'الموقع':'Location'}><Icon name="pin"/><span>{c.location?.trim()||missing}</span></div>
 </section>;
}
function ClientPanel({ view, ar }: {
    view: InboxDesktopView;
    ar: boolean;
}) {
    let _a;
    const c = view.customer;
    const starred = view.headerActions?.find(action=>action.id==='star')?.active;
    const tab = (_a = view.profileTab) !== null && _a !== void 0 ? _a : 'details';
    const setTab = (t: NonNullable<InboxDesktopView["profileTab"]>) => { let _a; return (_a = view.onProfileTabChange) === null || _a === void 0 ? void 0 : _a.call(view, t); };
    return <aside className={"vdi-panel vdi-profile"} data-inbox-panel={"customer"}><div className={"vdi-title-row"}><h2>{ar ? 'معلومات العميل' : 'Customer information'}</h2>{view.closeDetails && <ActionButton action={view.closeDetails}/>}</div>{!c ? <div className={"vdi-empty"}>{ar ? 'اختر محادثة لعرض التفاصيل' : 'Select a conversation'}</div> : <React.Fragment><section className={"vdi-hero vdi-hero-compact"}><Avatar person={c} channel={c.channel} large={true}/><h3>{c.name}</h3>{(c.badge || starred) && <span className={"vdi-badge"} title={!c.badge?(ar?'محادثة مميزة':'Starred conversation'):undefined}><Icon name={"crown"}/>{c.badge || (ar?'محادثة مميزة':'Starred conversation')}</span>}<ClientQuickActions view={view} ar={ar}/></section>{(view.followUp || view.activity) && <div className={"vdi-profile-tabs"} aria-label={ar ? 'أقسام العميل' : 'Customer sections'}>{(['details', ...(view.followUp ? ['followup'] : []), ...(view.activity ? ['activity'] : [])] as NonNullable<InboxDesktopView['profileTab']>[]).map(t => <button type={"button"} key={t} data-profile-tab={t} disabled={!view.onProfileTabChange} aria-pressed={tab === t} onClick={() => setTab(t)}><Icon name={t === 'details' ? 'user' : t === 'followup' ? 'clock' : 'activity'}/>{ar ? ({ details: 'التفاصيل', followup: 'المتابعة', activity: 'النشاط' })[t] : ({ details: 'Details', followup: 'Follow-up', activity: 'Activity' })[t]}</button>)}</div>}<div className={"vdi-profile-scroll vdi-scroll"}>{view.followUp?.nativePanel && <div hidden={tab !== "followup"}>{view.followUp.nativePanel}</div>}{tab === 'followup' && view.followUp ? (view.followUp.nativePanel ? null : <FollowUpPanel model={view.followUp} ar={ar}/>) : tab === 'activity' && view.activity ? <ActivityPanel model={view.activity} ar={ar}/> : <React.Fragment><ContactInformation customer={c} ar={ar}/><section className={"vdi-section"} data-feature="customer-tags"><div className={"vdi-section-heading"}><h3>{ar ? 'وسوم' : 'Tags'}</h3><ActionButton action={view.addTag??{id:'add-tag',label:ar?'إضافة وسم':'Add tag',icon:'plus',disabled:true,reason:ar?'إضافة الوسوم غير متاحة حاليًا.':'Adding tags is currently unavailable.'}} small label/></div>{c.tags?.length?<div className={"vdi-tags"}>{c.tags.map(t=><span key={t.id} className={`vdi-tag vdi-tag-${t.tone||'mint'}`}>{t.label}</span>)}</div>:<p className="vdi-muted">{view.extensionStatus==='loading'?(ar?'جارٍ التحميل…':'Loading…'):view.extensionStatus==='unavailable'?(ar?'تعذّر التحقق':'Unavailable'):(ar?'لا يوجد':'None')}</p>}{view.tagControls}</section><section className={"vdi-section"} data-feature="internal-notes"><div className={"vdi-section-heading"}><h3>{ar ? 'ملاحظات داخلية' : 'Internal notes'}</h3><ActionButton action={view.addNote?{...view.addNote,label:view.extension?.channel==='instagram'?(ar?'إضافة ملاحظة':'Add note'):c.note?.text.trim()?(ar?'تحرير الملاحظة':'Edit note'):(ar?'إضافة ملاحظة':'Add note')}:{id:'add-note',label:ar?'إضافة ملاحظة':'Add note',icon:'plus',disabled:true,reason:ar?'إضافة الملاحظات غير متاحة لهذه المحادثة حاليًا.':'Adding notes is currently unavailable for this conversation.'}} small label/></div><div className={"vdi-note"}>{c.note?.text.trim()||<span className="vdi-muted">{view.extension?.channel==='instagram'&&view.extensionStatus==='loading'?(ar?'جارٍ التحميل…':'Loading…'):view.extension?.channel==='instagram'&&view.extensionStatus==='unavailable'?(ar?'تعذّر التحقق':'Unavailable'):(ar?'لا يوجد':'None')}</span>}{(c.note?.attribution||c.note?.time)&&<p className={"vdi-note-meta"}>{c.note.attribution}{c.note.attribution&&c.note.time&&<br/>}{c.note.time}</p>}</div></section><CustomerTeam view={view} ar={ar}/>{view.customerExtra && <section className={"vdi-section"}>{view.customerExtra}</section>}</React.Fragment>}</div>{view.connection && <ConnectionPanel model={view.connection} ar={ar}/>}</React.Fragment>}</aside>;
}
function WorkspaceBar({ model: m, ar }: {
    model: VdiWorkspace;
    ar: boolean;
}) {
    const label = m.liveState === 'connected' ? (ar ? 'التحديثات متصلة' : 'Live updates connected') : m.liveState === 'connecting' ? (ar ? 'جارٍ الاتصال بالتحديثات' : 'Connecting live updates') : (ar ? 'التحديثات اللحظية متوقفة' : 'Live updates offline');
    return <div className={"vdi-workspace-bar"} data-feature={"workspace-status"}><div className={"vdi-workspace-context"}><strong>{m.label}</strong><span className={"vdi-status-divider"}/><span className={'vdi-live vdi-live-' + m.liveState}><i />{label}</span>{m.updatedAt && <small>{ar ? 'آخر تحديث ' : 'Updated '}{m.updatedAt}</small>}</div>{m.refresh && <ActionButton action={{ ...m.refresh, disabled: m.busy || m.refresh.disabled }} small={true} label={true}/>}</div>;
}
function WorkflowBar({ model: m, ar }: {
    model: VdiWorkflow;
    ar: boolean;
}) {
    let _a;
    return <div className={"vdi-workflow"} data-feature={"workflow"}><div className={"vdi-workflow-state"}><span className={"vdi-open-status"}>{m.statusLabel}</span><span className={'vdi-automation vdi-automation-' + m.automation}><Icon name={m.automation === 'allowed' ? 'sparkles' : 'pause'}/>{m.automationLabel}</span>{((_a = m.interventions) === null || _a === void 0 ? void 0 : _a.length) ? <span className={"vdi-interventions"} title={(m.interventions??[]).join(' · ')}><Icon name={"shield"}/>{ar ? 'تحتاج مراجعة' : 'Needs review'}</span> : null}</div><div className={"vdi-control-actions"}>{m.primary && <ActionButton action={m.primary} small={true} label={true}/>}{m.close && <ActionButton action={m.close} small={true} label={true}/>}</div></div>;
}
function Filters({ model: m, ar }: {
    model: VdiFilters;
    ar: boolean;
}) {
    let _a, _b;
    return <details className={"vdi-filters"} data-feature={"filters"}><summary><Icon name={"filter"}/>{ar ? 'القنوات والمتابعة' : 'Channels & follow-up'}<span>{m.worklist === 'all' ? (ar ? 'كل الحالات' : 'All states') : (_a = m.worklists.find(x => x.id === m.worklist)) === null || _a === void 0 ? void 0 : _a.label}</span><Icon name={"down"}/></summary><div className={"vdi-filter-fields"}><label>{ar ? 'القناة' : 'Channel'}<select aria-label={ar ? 'القناة' : 'Channel'} value={m.channel} onChange={e => m.onChannelChange(e.target.value)}>{m.channels.map(o => <option value={o.id} key={o.id}>{o.label}</option>)}</select></label><label>{ar ? 'قائمة المتابعة' : 'Worklist'}<select aria-label={ar ? 'قائمة المتابعة' : 'Worklist'} title={ar?'الأعداد تخص المحادثات المحمّلة فقط.':'Counts cover loaded conversations only.'} value={m.worklist} onChange={e => m.onWorklistChange(e.target.value)}>{m.worklists.map(o => <option value={o.id} key={o.id}>{o.label}{o.count === undefined ? '' : ` (${o.count})`}</option>)}</select></label>{m.stages && <label>{ar ? 'فلتر مرحلة العميل' : 'Filter lead stage'}<select aria-label={ar ? 'فلتر مرحلة العميل' : 'Filter lead stage'} value={(_b = m.stage) !== null && _b !== void 0 ? _b : 'all'} disabled={!m.onStageChange} onChange={e => { let _a; return (_a = m.onStageChange) === null || _a === void 0 ? void 0 : _a.call(m, e.target.value); }}>{m.stages.map(o => <option value={o.id} key={o.id}>{o.label}</option>)}</select></label>}</div></details>;
}
function Delivery({ state, ar }: {
    state: NonNullable<VdiMessage["deliveryState"]>;
    ar: boolean;
}) {
    const words = ar ? { accepted: 'قُبلت للإرسال', sent: 'أُرسلت', delivered: 'وُصّلت', read: 'قُرئت', failed: 'تعذّر التسليم', unknown: 'النتيجة غير مؤكدة' } : { accepted: 'Accepted', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Delivery failed', unknown: 'Unconfirmed' };
    return <span className={'vdi-delivery-state vdi-delivery-' + state} data-delivery={state} title={words[state]}>{['delivered', 'read'].includes(state) ? '✓✓' : state === 'sent' ? '✓' : '·'}{" "}{words[state]}</span>;
}
function ComposerTools({composer:c,ar}:{composer:VdiComposer;ar:boolean}) {
 const [emojiOpen,setEmojiOpen]=React.useState(false);
 const [quickOpen,setQuickOpen]=React.useState(false);
 const fileInput=React.useRef<HTMLInputElement>(null);
 const blocked=!!c.pending||!c.canSend;
 if(c.tools)return <>{c.tools.map(action=><ActionButton key={action.id} action={{...action,disabled:action.disabled||blocked}}/>)}</>;
 return <>
  <ActionButton action={{id:'more',label:ar?'أدوات إضافية':'More tools',icon:'more',disabled:true,reason:ar?'لا توجد أدوات إضافية متاحة حاليًا.':'No additional tools are currently available.'}}/>
  <div className="vdi-quick-tool" onKeyDown={event=>{if(event.key==='Escape'){setQuickOpen(false);event.currentTarget.querySelector('button')?.focus();}}}>
   <ActionButton action={{id:'quick',label:ar?'الردود السريعة':'Quick replies',icon:'hash',disabled:blocked||!c.quickReplies?.ready,reason:c.disabledReason,active:quickOpen&&!blocked,onClick:()=>setQuickOpen(open=>!open)}}/>
   {quickOpen&&!blocked&&c.quickReplies?.ready&&<div className="vdi-quick-panel" role="group" aria-label={ar?'الردود السريعة لهذه المحادثة':'Quick replies for this conversation'}>
    {c.quickReplies.items.length===0&&<p>{ar?'لا توجد ردود محفوظة.':'No saved replies.'}</p>}
    {c.quickReplies.items.map(reply=><div className="vdi-quick-row" key={reply.id}><button type="button" onClick={event=>{
     const textarea=event.currentTarget.closest('.vdi-composer')?.querySelector<HTMLTextAreaElement>('textarea[data-message-input]');
     if(!textarea||textarea.disabled||textarea.readOnly)return;
     const start=textarea.selectionStart,end=textarea.selectionEnd;c.onChange(c.value.slice(0,start)+reply.text+c.value.slice(end));setQuickOpen(false);
     requestAnimationFrame(()=>{if(textarea.isConnected){textarea.focus();textarea.setSelectionRange(start+reply.text.length,start+reply.text.length);}});
    }}>{reply.text}</button>{c.quickReplies?.canEdit&&<button type="button" aria-label={ar?'حذف الرد السريع':'Delete quick reply'} onClick={()=>c.quickReplies?.onRemove(reply.id)}>×</button>}</div>)}
    {c.quickReplies.canEdit&&<><label>{ar?'رد سريع جديد':'New quick reply'}<textarea value={c.quickReplies.value} maxLength={250} readOnly={c.quickReplies.reserved} onChange={event=>c.quickReplies?.onChange(event.target.value)}/></label>{c.quickReplies.reserved&&<p role="status">{ar?'أعد حفظ الرد نفسه للتحقق من نتيجته.':'Save the same reply again to verify its result.'}</p>}<button type="button" className="vdi-small-button" disabled={!c.quickReplies.value.trim()} onClick={c.quickReplies.onSave}>{ar?'حفظ الرد':'Save reply'}</button></>}
   </div>}
  </div>
  <div className="vdi-emoji-tool" onKeyDown={event=>{if(event.key==='Escape'){setEmojiOpen(false);event.currentTarget.querySelector('button')?.focus();}}}>
   <ActionButton action={{id:'smile',label:ar?'إضافة رمز تعبيري':'Add emoji',icon:'smile',disabled:blocked,reason:c.disabledReason,active:emojiOpen&&!blocked,onClick:()=>setEmojiOpen(open=>!open)}}/>
   {emojiOpen&&!blocked&&<div className="vdi-emoji-picker" role="group" aria-label={ar?'الرموز التعبيرية':'Emoji'}>{['😀','😊','👍','❤️','🙏','🎉'].map(emoji=><button key={emoji} type="button" aria-label={emoji} onClick={event=>{
    const textarea=event.currentTarget.closest('.vdi-composer')?.querySelector<HTMLTextAreaElement>('textarea[data-message-input]');
    const start=textarea?.selectionStart??c.value.length,end=textarea?.selectionEnd??start;
    c.onChange(c.value.slice(0,start)+emoji+c.value.slice(end));setEmojiOpen(false);
    requestAnimationFrame(()=>{if(textarea?.isConnected){textarea.focus();textarea.setSelectionRange(start+emoji.length,start+emoji.length);}});
   }}>{emoji}</button>)}</div>}
  </div>
  {c.attachment?<><ActionButton action={{id:'clip',label:ar?'إضافة مرفق':'Add attachment',icon:'clip',disabled:blocked||c.attachment.pending||!!c.attachment.name,onClick:()=>fileInput.current?.click()}}/><input ref={fileInput} type="file" aria-label={ar?'اختيار ملف':'Choose file'} accept="image/png,image/jpeg,application/pdf" hidden disabled={blocked||c.attachment.pending||!!c.attachment.name} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)c.attachment?.onSelect(file);}}/></>:<ActionButton action={{id:'clip',label:ar?'إضافة مرفق':'Add attachment',icon:'clip',disabled:true,reason:ar?'إرسال المرفقات غير متاح حاليًا.':'Sending attachments is currently unavailable.'}}/>}
 </>;
}
function ComposerView({composer:c,ar}:{composer:VdiComposer;ar:boolean}) {
 const labels={message:ar?'رسالة':'Message',ai:ar?'استخدام مساعد الذكاء الاصطناعي':'AI assistance',note:ar?'ملاحظة داخلية':'Internal note'};
 const modes=(['message','ai','note'] as const).filter(mode=>c.enabledModes.includes(mode));
 const selectableModes=modes.filter(mode=>!c.disabledModes?.includes(mode));
 return <section className="vdi-composer"><div className="vdi-compose-tabs" aria-label={ar?'نوع الكتابة':'Compose mode'}>{modes.map(mode=><button key={mode} type="button" className="vdi-tab" aria-pressed={c.mode===mode} disabled={c.disabledModes?.includes(mode)} title={c.disabledModes?.includes(mode)?c.disabledReason:undefined} onClick={()=>c.onModeChange(mode)} onKeyDown={event=>{const index=selectableModes.indexOf(mode);let next:number|undefined;if(event.key==='Home')next=0;if(event.key==='End')next=selectableModes.length-1;if(event.key==='ArrowRight')next=(index+(ar?-1:1)+selectableModes.length)%selectableModes.length;if(event.key==='ArrowLeft')next=(index+(ar?1:-1)+selectableModes.length)%selectableModes.length;if(next!==undefined&&selectableModes[next]){event.preventDefault();c.onModeChange(selectableModes[next]);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')[next]?.focus();}}}><Icon name={mode==='message'?'chat':mode==='ai'?'sparkles':'note'}/>{labels[mode]}</button>)}</div>
 {c.modePanels&&Object.entries(c.modePanels).map(([mode,panel])=><div key={mode} hidden={c.mode!==mode}>{panel}</div>)}
 {!c.modePanels?.[c.mode]&&<form className="vdi-compose-body" onSubmit={event=>{event.preventDefault();if(c.canSend&&!c.pending&&!c.attachment?.pending&&(c.value.trim()||(c.mode==='message'&&c.attachment?.name))&&(!c.attachment?.name||c.value.trim().length<=1024))c.onSubmit();}}>{c.ownershipNotice&&<p className="vdi-compose-owner" role="status">{c.ownershipNotice}</p>}{c.disabledReason&&!c.canSend&&<p className="vdi-muted" role="status">{c.disabledReason}</p>}<textarea data-message-input aria-label={labels[c.mode]} placeholder={c.mode==='note'?(ar?'ملاحظة داخلية — لا تُرسل للعميل':'Internal note — not sent to customer'):(ar?'اكتب رسالتك هنا...':'Write a message...')} value={c.value} disabled={!c.canSend||c.pending} onChange={event=>c.onChange(event.target.value)}/>{c.attachment?.name&&c.value.trim().length>1024&&<p role="status">{ar?'نص المرفق لا يتجاوز 1024 حرفًا.':'Attachment captions are limited to 1,024 characters.'}</p>}{c.attachment?.name&&<p role="status">{ar?'مرفق: ':'Attachment: '}{c.attachment.name} <button type="button" disabled={!c.attachment.canRemove||c.pending} onClick={c.attachment.onRemove}>{ar?'إزالة':'Remove'}</button></p>}{c.attachment?.error&&<p role="status">{c.attachment.error} {c.attachment.onRetry?<button type="button" onClick={c.attachment.onRetry}>{ar?'إعادة المحاولة':'Retry'}</button>:!c.attachment.name&&<button type="button" disabled={!c.attachment.canRemove} onClick={c.attachment.onRemove}>{ar?'إلغاء':'Dismiss'}</button>}</p>}{c.error&&<p role="alert" className="vdi-compose-error">{c.error}</p>}<div className="vdi-compose-tools"><button className="vdi-send" type="submit" disabled={!c.canSend||c.pending||c.attachment?.pending||(!c.value.trim()&&!(c.mode==='message'&&c.attachment?.name))||!!c.attachment?.name&&c.value.trim().length>1024}><Icon name="send"/>{c.pending?(ar?'جارٍ التنفيذ…':'Working…'):c.mode==='message'?(ar?'إرسال':'Send'):c.mode==='note'?(ar?'حفظ':'Save'):(ar?'مساعدة':'Assist')}</button><div className="vdi-tool-group"><ComposerTools composer={c} ar={ar}/></div></div></form>}
 {c.mode==='message'&&c.modePanels?.message&&<div className="vdi-tool-group vdi-custom-compose-tools"><ComposerTools composer={c} ar={ar}/></div>}
 </section>;
}
function ThreadPanel({ view, ar }: {
    view: InboxDesktopView;
    ar: boolean;
}) {
    let _b;
    const c = view.customer;
    return <section className={"vdi-panel vdi-thread"} data-inbox-panel={"thread"} data-channel-inbox={c?.channel}>{c ? <React.Fragment><header className={"vdi-thread-head"}><div className={"vdi-thread-person"}><Avatar person={c} channel={c.channel}/><div><h2>{c.name}</h2>{c.status && <p>{c.status}</p>}</div></div><div className={"vdi-thread-actions"}><ConversationHeaderActions view={view} ar={ar}/></div></header>{view.workflow && <WorkflowBar model={view.workflow} ar={ar}/>}{" "}{view.automationNotice && <div className={"vdi-status-rail"}>{view.automationNotice}</div>}<div className={"vdi-messages vdi-scroll"} role={"log"} aria-label={ar ? 'الرسائل' : 'Messages'} aria-live={"polite"} data-transcript={"true"} ref={node=>view.onTranscriptMount?.(node)} onScroll={view.onTranscriptScroll}>{view.loadEarlier && <div className={"vdi-history-button"}><ActionButton action={view.loadEarlier} small={true} label={true}/></div>}{view.unreadBoundaryLabel && <div className={"vdi-unread-boundary"}><span>{view.unreadBoundaryLabel}</span></div>}{view.messages.map(m => {
        let _a;
        return <article key={m.id} data-message-id={m.id} data-direction={m.direction==='incoming'?'inbound':'outbound'} className={`vdi-message vdi-message-${m.direction}`}>{m.direction === 'outgoing' && (m.author?<Avatar person={m.author} small/>:<span className="vdi-avatar vdi-avatar-small" title={m.senderLabel||(ar?'المرسل غير متاح':'Sender unavailable')}><Icon name={m.senderKind==='assistant'?'sparkles':'user'}/></span>)}<div className={"vdi-message-content"}><time className={"vdi-message-time"}>{m.time}{m.senderLabel && <span className={"vdi-sender-label"}>{m.senderLabel}</span>}{(_a = m.delivery) !== null && _a !== void 0 ? _a : (m.deliveryState && <Delivery state={m.deliveryState} ar={ar}/>)}</time><div className={"vdi-bubble"} dir={"auto"}>{m.text}{m.attachment}</div></div></article>;
    })}{view.messageExtras}</div>{(_b = view.nativeComposer) !== null && _b !== void 0 ? _b : (view.composer ? <ComposerView composer={view.composer} ar={ar}/> : <div className={"vdi-disabled-note"}>{ar ? 'الرد غير متاح لهذه المحادثة.' : 'Replies are not available for this conversation.'}</div>)}</React.Fragment> : <div className={"vdi-empty"}>{ar ? 'اختر محادثة للبدء' : 'Select a conversation to begin'}</div>}</section>;
}
function ListPanel({ view, ar }: {
    view: InboxDesktopView;
    ar: boolean;
}) {
    return <aside className={"vdi-panel vdi-list"} data-inbox-panel={"list"}><div className={"vdi-list-head"}><div className={"vdi-list-title"}><h2>{ar ? 'صندوق الوارد' : 'Inbox'}</h2>{view.newConversation && <ActionButton action={view.newConversation}/>}</div><label className={"vdi-search"}><Icon name={"search"}/><input type={"search"} value={view.query} onChange={e => view.onQueryChange(e.target.value)} placeholder={ar ? 'البحث في المحادثات والعملاء...' : 'Search conversations and customers...'} aria-label={ar ? 'البحث في المحادثات والعملاء' : 'Search conversations and customers'}/></label><div className={"vdi-tabs"} aria-label={ar ? 'تصفية المحادثات' : 'Conversation filters'}>{view.tabs.map(t => <button type={"button"} className={"vdi-tab"} key={t.id} aria-pressed={t.id === view.activeTab} onClick={() => view.onTabChange(t.id)}>{t.label}{typeof t.count === 'number' && <span className={"vdi-count"}>{t.count}</span>}</button>)}</div>{view.filters && <Filters model={view.filters} ar={ar}/>}{" "}{view.filterExtras && <div className={"vdi-extra-filters"}>{view.filterExtras}</div>}</div><div className={"vdi-list-items vdi-scroll"}>{view.conversations.map(row => <button type={"button"} key={row.id} className={"vdi-conversation"} aria-current={row.id === view.selectedId} onClick={() => view.onSelect(row.id)}><Avatar person={row} channel={row.channel}/><div className={"vdi-row-body"}><div className={"vdi-row-top"}><strong>{row.name}</strong><time>{row.time}</time></div>{row.subject && <div className={"vdi-subject"}>{row.subject}</div>}<div className={"vdi-preview"}>{row.preview}</div>{row.meta && <div className={"vdi-row-meta"}>{row.meta}</div>}</div>{!!row.unreadCount && <span className={"vdi-unread"} aria-label={`${row.unreadCount} ${ar ? 'غير مقروءة' : 'unread'}`}/>}</button>)}{!view.conversations.length && <div className={"vdi-empty"}>{view.emptyListLabel??(ar ? 'لا توجد محادثات مطابقة.' : 'No matching conversations.')}</div>}</div>{(view.listFooter || view.loadMore) && <div className={"vdi-list-footer"}>{view.loadMore && <ActionButton action={view.loadMore} small={true} label={true}/>}{view.listFooter}</div>}</aside>;
}
export function InboxDesktop({ view, locale = 'ar', height = 'calc(100dvh - 20px)' }: {
    view: InboxDesktopView;
    locale?: string;
    height?: string;
}) {
    const [pendingIntents, setPendingIntents] = React.useState<Record<string, PendingInboxIntents>>({});
    if (view.extension && view.customer && view.state === 'ready') {
        const key = `${view.scopeKey}:${view.extension.channel}:${view.extension.conversationId}`;
        return <InboxExtensionBridge key={key} view={view} ar={locale === 'ar'} pendingIntents={pendingIntents[key]} onIntentChange={(kind,intent,expectedId) => setPendingIntents(old => {
            const next = { ...old[key] };
            if (expectedId && next[kind]?.id !== expectedId) return old;
            if (intent) next[kind] = intent; else delete next[kind];
            const updated = { ...old };
            if (next.tag || next.note || next.quick || next.file) updated[key] = next; else delete updated[key];
            return updated;
        })} render={next => <InboxDesktopSurface view={next} locale={locale} height={height}/>}/>;
    }
    return <InboxDesktopSurface view={view} locale={locale} height={height}/>;
}
function InboxDesktopSurface({ view, locale, height }: { view: InboxDesktopView; locale: string; height: string }) {
    let _a;
    const ar = locale === 'ar';
    const [detailsState,setDetailsState]=React.useState({scope:view.scopeKey,hidden:false});
    const detailsHidden=detailsState.scope===view.scopeKey&&detailsState.hidden;
    const toggleDetails=(hidden:boolean)=>setDetailsState({scope:view.scopeKey,hidden});
    const panelView:InboxDesktopView={...view,
        closeDetails:{id:'hide-details',label:ar?'إخفاء معلومات العميل':'Hide customer information',icon:'back',onClick:()=>toggleDetails(true)},
        headerActions:detailsHidden?[...(view.headerActions??[]),{id:'show-details',label:ar?'إظهار معلومات العميل':'Show customer information',icon:'user',onClick:()=>toggleDetails(false)}]:view.headerActions,
    };
    const style: CSSProperties & {
        "--vdi-height": string;
    } = { '--vdi-height': height };
    // Never render retained customer content on unknown/denied authority.
    if (view.state !== 'ready')
        return <section className={"vdi vdi-desktop-state"} dir={ar ? 'rtl' : 'ltr'} style={style} data-state={view.state}><div className={"vdi-state"} role={view.state === 'loading' ? 'status' : 'alert'}><p>{view.message}</p>{view.onRetry && <button type={"button"} className={"vdi-small-button"} disabled={view.retrying} onClick={view.onRetry}>{view.retrying ? (ar ? 'جارٍ التحقق…' : 'Checking…') : (ar ? 'إعادة المحاولة' : 'Retry')}</button>}</div></section>;
    return <div key={view.scopeKey} className={"vdi vdi-desktop"} dir={ar ? 'rtl' : 'ltr'} style={style}>{view.workspace && <WorkspaceBar model={view.workspace} ar={ar}/>}{" "}{view.notice && <div className={"vdi-notice"} role={"status"}>{view.notice}</div>}<div className={"vdi-grid"} data-details-hidden={detailsHidden}><ClientPanel key={`${view.scopeKey}:${(_a = view.selectedId) !== null && _a !== void 0 ? _a : ''}`} view={panelView} ar={ar}/><ThreadPanel view={panelView} ar={ar}/><ListPanel view={view} ar={ar}/></div></div>;
}

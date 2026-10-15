import type {InboxChannel} from './inbox-presentation';
export function ChannelBadge({channel,ar=false}:{channel:InboxChannel;ar?:boolean}) {
 return <span className="channel-badge" data-channel={channel}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
 {channel==='instagram'?<><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6"/></>:<><path d="M20 11.5a8.5 8.5 0 0 1-12.7 7.4L3 21l1.7-4.5A8.5 8.5 0 1 1 20 11.5Z"/><path d="M8 7c0 4 3 7 7 7l1-2-3-1-1 1-2-2 1-1-1-3Z"/></>}
 </svg>{channel==='whatsapp'?(ar?'واتساب':'WhatsApp'):(ar?'إنستجرام':'Instagram')}</span>;
}

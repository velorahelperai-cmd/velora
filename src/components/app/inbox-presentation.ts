import type { WhatsappInboxItem } from '@/lib/whatsapp/inbox-contracts';
import type { InstagramConversation } from '@/lib/instagram/inbox-contracts';
export type InboxChannel = 'whatsapp' | 'instagram';
export type InboxRow = { key:string; id:string; channel:InboxChannel; name:string; preview:string; at:number; unread:number; assignedTo:string|null };
/** Channel is part of identity. Names and provider IDs never merge people. */
export function inboxRows(wa:readonly WhatsappInboxItem[],ig:readonly InstagramConversation[],ar:boolean):InboxRow[] {
 const rows:InboxRow[]=[...wa.map(c=>({key:`whatsapp:${c.id}`,id:c.id,channel:'whatsapp' as const,name:c.customer||c.phone,
  preview:c.messages.at(-1)?.text??'',at:c.messages.at(-1)?.at??0,unread:c.unreadCount,assignedTo:c.assignedTo??null})),
 ...ig.map(c=>({key:`instagram:${c.id}`,id:c.id,channel:'instagram' as const,name:c.counterpartyId,
  preview:c.latestMessage?.content.kind==='text'?c.latestMessage.content.text:c.latestMessage?(ar?'رسالة غير نصية':'Non-text message'):'',
  at:Date.parse(c.lastReceivedAt??'')||0,unread:c.unreadCount,assignedTo:c.assignedTo}))];
 return rows.sort((a,b)=>b.at-a.at||a.key.localeCompare(b.key));
}
export function inboxHref(channel:InboxChannel|null,id:string|null,filter:InboxChannel|'all'='all') {
 const p=new URLSearchParams();if(filter!=='all')p.set('channel',filter);
 if(channel&&id){p.set('source',channel);p.set(channel==='whatsapp'?'c':'thread',id);}
 return '/app/conversations'+(p.size?'?'+p.toString():'');
}

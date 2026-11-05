import type {WhatsappInboxItem} from '@/lib/whatsapp/inbox-contracts';
import {matchesLeadWorklist,type LeadWorklist} from '@/lib/whatsapp/leads';
import {matchesUnifiedInboxFilter} from './conversations-inbox';
import type {InboxRow} from './inbox-presentation';
import type {InboxDesktopView,VdiMessage} from './inbox-desktop';
import type {Conversation} from '@/lib/demo-state';
/** Pure projection of already authorized data. No fetching, merging identities or invented metadata. */
export function desktopRows(rows:readonly InboxRow[],ar:boolean):InboxDesktopView['conversations'] {
 return rows.map(row=>({id:row.key,name:row.name,initials:row.name.slice(0,1).toUpperCase(),channel:row.channel,preview:row.preview,time:row.at?new Date(row.at).toLocaleTimeString(ar?'ar-OM':'en-GB',{hour:'2-digit',minute:'2-digit'}):'',unreadCount:row.unread}));
}
export function desktopWhatsappMessages(messages:Conversation['messages'],ar:boolean):VdiMessage[]{
 return messages.map(message=>({id:message.id,direction:message.from==='customer'?'incoming':'outgoing',senderKind:message.from==='assistant'?'assistant':message.from==='staff'?'staff':undefined,text:message.text,time:new Date(message.at).toLocaleTimeString(ar?'ar-OM':'en-GB',{hour:'2-digit',minute:'2-digit'}),senderLabel:message.from==='assistant'?(ar?'فيلورا · رد آلي':'Velora · Automated reply'):message.from==='staff'?(ar?'الفريق':'Staff'):undefined,deliveryState:message.deliveryState??undefined,attachment:message.source?message.source:undefined}));
}

/** Filters only loaded, authorized rows; Instagram has no manual lead-stage model. */
export function desktopWorklistMatches(row:InboxRow,item:WhatsappInboxItem|undefined,worklist:string,now:number,timezone:string|null):boolean {
 if(worklist==='all')return true;
 if(worklist==='unread')return row.unread>0;
 if(row.channel!=='whatsapp'||!item)return false;
 if(worklist==='staff')return (item.intervention?.reasons.length??0)>0;
 if(worklist==='noura'||worklist==='resolved')return matchesUnifiedInboxFilter(item,worklist);
 if(['awaiting_staff','follow_up_today','overdue','trial_or_quote'].includes(worklist))return matchesLeadWorklist(item,worklist as LeadWorklist,now,timezone);
 return false;
}

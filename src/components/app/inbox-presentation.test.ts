import {expect,it} from 'vitest';
import {inboxRows,inboxHref} from './inbox-presentation';
import type {WhatsappInboxItem} from '@/lib/whatsapp/inbox-contracts';
import type {InstagramConversation} from '@/lib/instagram/inbox-contracts';
it('never merges matching names or conversation IDs between channels; orders actual activity',()=>{
 const wa={id:'same',customer:'101',phone:'101',unreadCount:1,messages:[{text:'WA',at:100}]} as WhatsappInboxItem;
 const ig={id:'same',counterpartyId:'101',unreadCount:2,lastReceivedAt:new Date(200).toISOString(),assignedTo:null,latestMessage:{content:{kind:'text',text:'IG'}}} as InstagramConversation;
 const rows=inboxRows([wa],[ig],false);expect(rows.map(r=>r.key)).toEqual(['instagram:same','whatsapp:same']);expect(rows.map(r=>r.preview)).toEqual(['IG','WA']);
});
it('keeps a channel filter on selection and back, never routes a reply into the other channel',()=>{
 expect(inboxHref('instagram','id','instagram')).toBe('/app/conversations?channel=instagram&source=instagram&thread=id');
 expect(inboxHref(null,null,'whatsapp')).toBe('/app/conversations?channel=whatsapp');
});

/** Four independent facts. Neither a role grant nor a provider link buys a channel. */
export const CHANNELS = ['whatsapp','instagram'] as const;
export type Channel = typeof CHANNELS[number];
export type ChannelContract = {
 companyId:string; planVersionId:string|null;
 plan_entitlements:{status:'approved';channelCount:1|2}|{status:'UNCONFIGURED'};
 selected_channels:{planVersionId:string|null;revision:number;channels:Channel[]};
 subscription:{state:'active'|'grace'|'locked'|'none'|'unverified'|'awaiting_activation';expiresAt:string|null;operationalReady?:boolean;operationalReadyChannels?:Channel[]};
};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function parseChannelContract(v:unknown,companyId:string):ChannelContract|null {
 if(!object(v)||v.companyId!==companyId||!(v.planVersionId===null||typeof v.planVersionId==='string')||!object(v.plan_entitlements)||!object(v.selected_channels)||!object(v.subscription))return null;
 const p=v.plan_entitlements,s=v.selected_channels,b=v.subscription;
 if(!(p.status==='UNCONFIGURED'||p.status==='approved'&&(p.channelCount===1||p.channelCount===2))
  ||!(s.planVersionId===null||typeof s.planVersionId==='string')||!Number.isSafeInteger(s.revision)||Number(s.revision)<0
  ||!Array.isArray(s.channels)||s.channels.some(c=>!CHANNELS.includes(c as Channel))||new Set(s.channels).size!==s.channels.length
  ||!['active','grace','locked','none','unverified','awaiting_activation'].includes(String(b.state))||!(b.expiresAt===null||typeof b.expiresAt==='string'&&Number.isFinite(Date.parse(b.expiresAt)))
  ||b.operationalReady!==undefined&&typeof b.operationalReady!=='boolean'
  ||b.operationalReadyChannels!==undefined&&(!Array.isArray(b.operationalReadyChannels)||b.operationalReadyChannels.some(ch=>!CHANNELS.includes(ch as Channel))||new Set(b.operationalReadyChannels).size!==b.operationalReadyChannels.length))return null;
 return v as unknown as ChannelContract;
}
export function selectedIncludedChannels(c:ChannelContract):Channel[] {
 if(c.plan_entitlements.status!=='approved'||!c.planVersionId||c.selected_channels.planVersionId!==c.planVersionId
  ||c.selected_channels.channels.length!==c.plan_entitlements.channelCount)return [];
 if(c.plan_entitlements.channelCount===2&&!CHANNELS.every(ch=>c.selected_channels.channels.includes(ch)))return [];
 return [...c.selected_channels.channels];
}
/** Native connection, role, account scope, rollout and provider window checks still apply. */
export function channelOperationAllowed(c:ChannelContract,ch:Channel,op:'read'|'send'|'connect'|'automate'):boolean {
 if(!selectedIncludedChannels(c).includes(ch))return false;
 if(op==='automate'&&c.subscription.operationalReady!==undefined&&(!c.subscription.operationalReady||!c.subscription.operationalReadyChannels?.includes(ch)))return false;
 return c.subscription.state==='active'||op==='read'&&c.subscription.state==='grace'||c.subscription.state==='awaiting_activation'&&(op==='read'||op==='connect'||op==='send');
}

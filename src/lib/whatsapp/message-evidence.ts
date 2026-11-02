/** Display evidence only: never a send, billing or activation decision. */
export type WhatsappMessageEvidence = {
 companyId:string;
 linkId:string;
 generation:number;
 latestCompanyInboundAt:string|null;
 currentLinkDeliveredAt:string|null;
};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Inbound company history deliberately does not claim a current-link generation. */
export function parseWhatsappMessageEvidence(raw:unknown,expected:{companyId:string;linkId:string},now=Date.now()):WhatsappMessageEvidence|null {
 if(!record(raw)||raw.ok!==true||!uuid(raw.company_id)||!uuid(raw.link_id)
  ||raw.company_id!==expected.companyId||raw.link_id!==expected.linkId
  ||!Number.isSafeInteger(raw.generation)||Number(raw.generation)<1)return null;
 const stamp=(value:unknown)=>value===null||typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now;
 if(!stamp(raw.latest_company_inbound_at)||!stamp(raw.current_link_delivered_at))return null;
 return {companyId:raw.company_id,linkId:raw.link_id,generation:Number(raw.generation),
  latestCompanyInboundAt:raw.latest_company_inbound_at as string|null,currentLinkDeliveredAt:raw.current_link_delivered_at as string|null};
}

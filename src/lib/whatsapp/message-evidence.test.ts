import {expect,it} from 'vitest';
import {parseWhatsappMessageEvidence} from './message-evidence';
const expected={companyId:'10000000-0000-4000-8000-000000000001',linkId:'10000000-0000-4000-8000-000000000002'};
const raw={ok:true,company_id:expected.companyId,link_id:expected.linkId,generation:2,latest_company_inbound_at:'2026-11-01T10:00:00Z',current_link_delivered_at:'2026-11-01T11:00:00Z'};
const now=Date.parse('2026-11-02T00:00:00Z');
it('keeps company inbound history distinct from current-link delivery and exposes no activation flag',()=>{
 const result=parseWhatsappMessageEvidence(raw,expected,now);
 expect(result).toEqual({...expected,generation:2,latestCompanyInboundAt:raw.latest_company_inbound_at,currentLinkDeliveredAt:raw.current_link_delivered_at});
 expect(result).not.toHaveProperty('receptionSendTested');expect(result).not.toHaveProperty('sendReady');
});
it('accepts absent evidence without manufacturing successful tests',()=>{
 expect(parseWhatsappMessageEvidence({...raw,latest_company_inbound_at:null,current_link_delivered_at:null},expected,now)).toMatchObject({latestCompanyInboundAt:null,currentLinkDeliveredAt:null});
});
it('rejects foreign scopes, malformed generations, missing and future timestamps',()=>{
 for(const patch of [{ok:false},{company_id:raw.link_id},{link_id:raw.company_id},{generation:0},{generation:1.5},{generation:'2'},{latest_company_inbound_at:undefined},{current_link_delivered_at:'invalid'},{current_link_delivered_at:'2099-01-01T00:00:00Z'}])expect(parseWhatsappMessageEvidence({...raw,...patch},expected,now)).toBeNull();
});

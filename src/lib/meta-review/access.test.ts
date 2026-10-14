import {expect,it} from 'vitest';
import {reviewDispatchCurrent,parseReviewGrant,type ReviewGrant} from './access';
const now=Date.parse('2026-10-13T15:00:00Z');
const grant:ReviewGrant={id:'abcdefab-0000-4000-8000-000000000001',channel:'whatsapp',app_id:'1000',asset_id:'100',source_account_id:'200',recipient_ids:['96890000000'],send_limit:50,used_count:1,expires_at:'2026-10-20T15:00:00Z',revoked_at:null};
it('parses only a bounded stored grant',()=>{expect(parseReviewGrant(grant)).toEqual(grant);for(const invalid of [{...grant,send_limit:51},{...grant,used_count:51},{...grant,recipient_ids:[]},{...grant,revoked_at:'not-a-date'}])expect(parseReviewGrant(invalid)).toBeNull();});
it('dispatch attestation binds grant, company, channel and exact source asset at the last boundary',()=>{
 const proof={grant_id:grant.id,company_id:'abcdefab-0000-4000-8000-000000000002',channel:'whatsapp',asset_id:'100',expires_at:grant.expires_at};
 expect(reviewDispatchCurrent(proof,grant,proof.company_id,'whatsapp','100',now)).toBe(true);
 for(const altered of [{...proof,grant_id:'another'},{...proof,company_id:'another'},{...proof,channel:'instagram'},{...proof,asset_id:'another'},{...proof,expires_at:'2026-10-13T15:00:00Z'}])expect(reviewDispatchCurrent(altered,grant,proof.company_id,'whatsapp','100',now)).toBe(false);
 expect(reviewDispatchCurrent(proof,{...grant,revoked_at:'2026-10-13T14:00:00Z'},proof.company_id,'whatsapp','100',now)).toBe(false);
});

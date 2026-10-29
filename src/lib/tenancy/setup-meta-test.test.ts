import {describe,expect,it} from 'vitest';
import {setupMetaTestConfig} from './setup-meta-test';
const scope={expectedAccountId:'11111111-1111-4111-8111-111111111111',companyId:'22222222-2222-4222-8222-222222222222',branchId:'33333333-3333-4333-8333-333333333333'};
const now=Date.parse('2026-10-29T00:00:00Z');
const env={VELORA_SETUP_META_TEST_ENABLED:'true',VELORA_SETUP_META_TEST_ACCOUNT_ID:scope.expectedAccountId,VELORA_SETUP_META_TEST_COMPANY_ID:scope.companyId,VELORA_SETUP_META_TEST_BRANCH_ID:scope.branchId,VELORA_SETUP_META_TEST_EXPIRES_AT:'2026-11-01T00:00:00Z',WHATSAPP_CONFIGURATION_MODE:'meta_test',WHATSAPP_TEST_PHONE_NUMBER_ID:'123',WHATSAPP_TEST_WABA_ID:'456',WHATSAPP_EMBEDDED_SIGNUP_APP_ID:'789',WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION:'v26.0'};
describe('scoped Setup Meta test access',()=>{
 it('is off unless explicitly configured and never enables the live path',()=>{expect(setupMetaTestConfig(scope,{},now)).toBeNull();expect(setupMetaTestConfig(scope,{...env,WHATSAPP_CONFIGURATION_MODE:'live'},now)).toBeNull();expect(setupMetaTestConfig(scope,env,now)?.expiresAt).toBe(env.VELORA_SETUP_META_TEST_EXPIRES_AT);});
 it.each(['expectedAccountId','companyId','branchId'] as const)('denies a different %s even when test mode is enabled',field=>{expect(setupMetaTestConfig({...scope,[field]:'99999999-9999-4999-8999-999999999999'},env,now)).toBeNull();});
 it.each(['','bad','2026-10-28T00:00:00Z','2026-11-07T00:00:00Z'])('fails closed for expired, missing or unbounded expiry %s',expiry=>{expect(setupMetaTestConfig(scope,{...env,VELORA_SETUP_META_TEST_EXPIRES_AT:expiry},now)).toBeNull();});
 it('rejects malformed identifiers and graph configuration',()=>{expect(setupMetaTestConfig({...scope,branchId:'bad'},env,now)).toBeNull();expect(setupMetaTestConfig(scope,{...env,WHATSAPP_TEST_WABA_ID:'../secrets'},now)).toBeNull();expect(setupMetaTestConfig(scope,{...env,WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION:'latest'},now)).toBeNull();});
});

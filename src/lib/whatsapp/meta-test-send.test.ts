import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {sendWhatsappText} from './send';

beforeEach(()=>{
 vi.stubEnv('WHATSAPP_CONFIGURATION_MODE','meta_test');
 vi.stubEnv('WHATSAPP_TEST_ALLOW_EXTERNAL_SEND','true');
 vi.stubEnv('WHATSAPP_TEST_PHONE_NUMBER_ID','1261345677073276');
 vi.stubEnv('WHATSAPP_TEST_ACCESS_TOKEN','test-token');
 vi.stubEnv('WHATSAPP_ACCESS_TOKEN','live-token');
 vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION','v26.0');
 vi.stubEnv('WHATSAPP_TEST_RECIPIENTS','');
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
const input={phoneNumberId:'1261345677073276',toWaId:'96890000000',body:'Review reply'};

it('does not dispatch without an explicit test recipient allowlist',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
 expect(await sendWhatsappText(input)).toEqual({ok:false,code:'RECIPIENT_NOT_ALLOWED'});
 expect(fetch).not.toHaveBeenCalled();
});
it('does not dispatch to another or malformed recipient',async()=>{
 vi.stubEnv('WHATSAPP_TEST_RECIPIENTS','96890000000');
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
 for(const toWaId of ['96890000001','+96890000000','96890000000 '])
  expect(await sendWhatsappText({...input,toWaId})).toEqual({ok:false,code:'RECIPIENT_NOT_ALLOWED'});
 expect(fetch).not.toHaveBeenCalled();
});
it('uses the configured Graph version and only the test token for the exact allowed recipient',async()=>{
 vi.stubEnv('WHATSAPP_TEST_RECIPIENTS','96890000001,96890000000');
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({messages:[{id:'wamid.test'}]}),{status:200}));
 expect(await sendWhatsappText(input)).toEqual({ok:true,waMessageId:'wamid.test'});
 expect(fetch).toHaveBeenCalledOnce();
 expect(fetch.mock.calls[0][0]).toBe('https://graph.facebook.com/v26.0/1261345677073276/messages');
 expect(new Headers(fetch.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer test-token');
});
it('never dispatches test messages through the legacy version when version is absent',async()=>{
 vi.stubEnv('WHATSAPP_TEST_RECIPIENTS','96890000000');
 vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION','');
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
 expect(await sendWhatsappText(input)).toEqual({ok:false,code:'NEEDS_SETUP'});
 expect(fetch).not.toHaveBeenCalled();
});

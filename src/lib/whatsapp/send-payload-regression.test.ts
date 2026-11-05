import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sendWhatsappText } from './send';

beforeEach(() => {
  vi.stubEnv('WHATSAPP_ROUTING_MODE', 'single_tenant');
  vi.stubEnv('WHATSAPP_ALLOW_EXTERNAL_SEND', 'true');
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'synthetic-token');
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '100000000000001');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('preserves the bound number, recipient and text in the native Graph request', async () => {
  const graph=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({messages:[{id:'wamid.fixture'}]})));
  const result=await sendWhatsappText({toWaId:'96890000000',phoneNumberId:'100000000000001',body:'  Hello  '});
  expect(result).toEqual({ok:true,waMessageId:'wamid.fixture'});
  expect(graph).toHaveBeenCalledOnce();
  expect(graph.mock.calls[0]?.[0]).toBe('https://graph.facebook.com/v22.0/100000000000001/messages');
  expect(JSON.parse(String(graph.mock.calls[0]?.[1]?.body))).toEqual({messaging_product:'whatsapp',to:'96890000000',type:'text',text:{body:'Hello'}});
});

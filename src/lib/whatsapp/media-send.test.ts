import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendWhatsappMedia, uploadWhatsappMedia, type WhatsappUploadedMedia } from './send';

const common={toWaId:'96890000000',phoneNumberId:'100000000000001',companyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',conversationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',actorId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',linkId:null,linkGeneration:null,intentId:'11111111-1111-4111-8111-111111111111',attemptToken:'22222222-2222-4222-8222-222222222222',attachmentId:'44444444-4444-4444-8444-444444444444'};
const file={filename:'invoice.pdf',mime:'application/pdf',base64:'JVBERi0='};
beforeEach(()=>{
  vi.stubEnv('WHATSAPP_ROUTING_MODE','single_tenant');
  vi.stubEnv('WHATSAPP_CONFIGURATION_MODE','live');
  vi.stubEnv('WHATSAPP_ALLOW_EXTERNAL_SEND','true');
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN','synthetic-token');
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID',common.phoneNumberId);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

describe('offline WhatsApp media transport',()=>{
  it('uploads and dispatches the same bound file exactly once',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({id:'123456'})))
      .mockResolvedValueOnce(new Response(JSON.stringify({messages:[{id:'wamid.media'}]})));
    const uploaded=await uploadWhatsappMedia({...common,...file,caption:'Invoice'});
    expect(uploaded.ok).toBe(true);if(!uploaded.ok)return;
    expect(graph.mock.calls[0]?.[0]).toBe('https://graph.facebook.com/v22.0/100000000000001/media');
    expect(graph.mock.calls[0]?.[1]).toMatchObject({redirect:'error',cache:'no-store'});
    const form=graph.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get('messaging_product')).toBe('whatsapp');expect(form.get('type')).toBe('application/pdf');
    expect((form.get('file') as File).name).toBe('invoice.pdf');
    expect(await sendWhatsappMedia({...common,media:uploaded.media,caption:'Invoice'})).toEqual({ok:true,waMessageId:'wamid.media'});
    expect(graph.mock.calls[1]?.[1]).toMatchObject({redirect:'error',cache:'no-store'});
    expect(JSON.parse(String(graph.mock.calls[1]?.[1]?.body))).toEqual({messaging_product:'whatsapp',to:common.toWaId,type:'document',document:{id:'123456',filename:'invoice.pdf',caption:'Invoice'}});
    expect(await sendWhatsappMedia({...common,media:uploaded.media})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(graph).toHaveBeenCalledTimes(2);
  });
  it('uses the image payload for an uploaded image',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({id:'123456'})))
      .mockResolvedValueOnce(new Response(JSON.stringify({messages:[{id:'wamid.image'}]})));
    const uploaded=await uploadWhatsappMedia({...common,filename:'photo.jpg',mime:'image/jpeg',base64:'/9j/'});
    if(!uploaded.ok)throw Error('fixture upload failed');
    expect(await sendWhatsappMedia({...common,media:uploaded.media})).toEqual({ok:true,waMessageId:'wamid.image'});
    expect(JSON.parse(String(graph.mock.calls[1]?.[1]?.body))).toEqual({messaging_product:'whatsapp',to:common.toWaId,type:'image',image:{id:'123456'}});
  });
  it('rejects mismatched identity and consumes the uploaded proof before dispatch',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({id:'123456'})));
    const uploaded=await uploadWhatsappMedia({...common,...file});if(!uploaded.ok)throw Error('fixture upload failed');
    expect(await sendWhatsappMedia({...common,toWaId:'96890000001',media:uploaded.media})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(await sendWhatsappMedia({...common,media:uploaded.media})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(graph).toHaveBeenCalledOnce();
  });
  it('does not transfer upload proof across native send attempts',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({id:'123456'})));
    const uploaded=await uploadWhatsappMedia({...common,...file});if(!uploaded.ok)throw Error('fixture upload failed');
    expect(await sendWhatsappMedia({...common,attemptToken:'33333333-3333-4333-8333-333333333333',media:uploaded.media})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(graph).toHaveBeenCalledOnce();
  });
  it('does not transfer upload proof to another attachment',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'123456'})));
    const uploaded=await uploadWhatsappMedia({...common,...file});if(!uploaded.ok)throw Error('fixture upload failed');
    expect(await sendWhatsappMedia({...common,attachmentId:'55555555-5555-4555-8555-555555555555',media:uploaded.media})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(graph).toHaveBeenCalledOnce();
  });
  it('does not transfer upload proof to another conversation',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'123456'})));
    const uploaded=await uploadWhatsappMedia({...common,...file});if(!uploaded.ok)throw Error('fixture upload failed');
    expect(await sendWhatsappMedia({...common,conversationId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',media:uploaded.media})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(graph).toHaveBeenCalledOnce();
  });
  it.each([
    { companyId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
    { actorId:'ffffffff-ffff-4fff-8fff-ffffffffffff' },
  ])('does not transfer upload proof across workspace or actor %j',async(changed)=>{
    const graph=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'123456'})));
    const uploaded=await uploadWhatsappMedia({...common,...file});if(!uploaded.ok)throw Error('fixture upload failed');
    expect(await sendWhatsappMedia({...common,...changed,media:uploaded.media})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(graph).toHaveBeenCalledOnce();
  });
  it('does not dispatch a caption different from the claimed upload',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'123456'})));
    const uploaded=await uploadWhatsappMedia({...common,...file,caption:'Original'});if(!uploaded.ok)throw Error('fixture upload failed');
    expect(await sendWhatsappMedia({...common,media:uploaded.media,caption:'Changed'})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(graph).toHaveBeenCalledOnce();
  });
  it('snapshots file metadata before awaiting the upload',async()=>{
    let resolveUpload!: (response:Response)=>void;
    const graph=vi.spyOn(globalThis,'fetch').mockImplementationOnce(()=>new Promise(resolve=>{resolveUpload=resolve;}))
      .mockResolvedValueOnce(new Response(JSON.stringify({messages:[{id:'wamid.media'}]})));
    const input={...common,...file};const pending=uploadWhatsappMedia(input);
    input.filename='changed.png';input.mime='image/png';
    resolveUpload(new Response(JSON.stringify({id:'123456'})));
    const uploaded=await pending;if(!uploaded.ok)throw Error('fixture upload failed');
    expect(await sendWhatsappMedia({...common,media:uploaded.media})).toEqual({ok:true,waMessageId:'wamid.media'});
    expect(JSON.parse(String(graph.mock.calls[1]?.[1]?.body)).document.filename).toBe('invoice.pdf');
  });
  it('never dispatches fabricated, malformed or unconfirmed uploads',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
    expect(await sendWhatsappMedia({...common,media:{kind:'whatsapp-uploaded-media'} as WhatsappUploadedMedia})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(await uploadWhatsappMedia({...common,...file,base64:'iVBORw0KGgo='})).toMatchObject({ok:false,detail:'invalid_media'});
    expect(graph).not.toHaveBeenCalled();
    expect(await uploadWhatsappMedia({...common,...file})).toEqual({ok:false,code:'AMBIGUOUS',detail:'upload_evidence_unconfirmed'});
    expect(graph).toHaveBeenCalledOnce();
  });
  it('treats contradictory upload evidence as ambiguous and redacts provider failures',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({id:'123456',error:{code:190,message:'private'}})))
      .mockResolvedValueOnce(new Response(JSON.stringify({error:{code:190,message:'synthetic-token customer'}}),{status:400}));
    expect(await uploadWhatsappMedia({...common,...file})).toEqual({ok:false,code:'AMBIGUOUS',detail:'upload_evidence_unconfirmed'});
    expect(await uploadWhatsappMedia({...common,...file})).toEqual({ok:false,code:'GRAPH_REJECTED',detail:'graph_190'});
    expect(graph).toHaveBeenCalledTimes(2);
  });
  it('does not upload when sending is disabled',async()=>{
    vi.stubEnv('WHATSAPP_ALLOW_EXTERNAL_SEND','false');
    const graph=vi.spyOn(globalThis,'fetch');
    expect(await uploadWhatsappMedia({...common,...file})).toEqual({ok:false,code:'SEND_DISABLED'});
    expect(graph).not.toHaveBeenCalled();
  });
  it('rechecks the send switch after uploading',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'123456'})));
    const uploaded=await uploadWhatsappMedia({...common,...file});if(!uploaded.ok)throw Error('fixture upload failed');
    vi.stubEnv('WHATSAPP_ALLOW_EXTERNAL_SEND','false');
    expect(await sendWhatsappMedia({...common,media:uploaded.media})).toEqual({ok:false,code:'SEND_DISABLED'});
    expect(graph).toHaveBeenCalledOnce();
  });
  it('does not upload a tenant file outside its proven service window',async()=>{
    vi.stubEnv('WHATSAPP_ROUTING_MODE','tenant_registry');
    vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION','v25.0');
    const graph=vi.spyOn(globalThis,'fetch');
    expect(await uploadWhatsappMedia({...common,...file,accessToken:'synthetic-token',serviceWindowExpiresAt:'2000-01-01T00:00:00Z'})).toEqual({ok:false,code:'SERVICE_WINDOW_CLOSED'});
    expect(graph).not.toHaveBeenCalled();
  });
  it('does not upload for a tenant without the claimed link generation',async()=>{
    vi.stubEnv('WHATSAPP_ROUTING_MODE','tenant_registry');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION','v25.0');
    const graph=vi.spyOn(globalThis,'fetch');
    expect(await uploadWhatsappMedia({...common,...file,accessToken:'synthetic-token',serviceWindowExpiresAt:new Date(Date.now()+3_600_000).toISOString()})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(graph).not.toHaveBeenCalled();
  });
  it('denies a changed access binding and an expired upload',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({id:'123456'})));
    const first=await uploadWhatsappMedia({...common,...file});if(!first.ok)throw Error('fixture upload failed');
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN','changed-token');
    expect(await sendWhatsappMedia({...common,media:first.media})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    const second=await uploadWhatsappMedia({...common,...file});if(!second.ok)throw Error('fixture upload failed');
    vi.spyOn(Date,'now').mockReturnValue(Date.now()+60_001);
    expect(await sendWhatsappMedia({...common,media:second.media})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(graph).toHaveBeenCalledTimes(2);
  });
  it('keeps an uncertain provider response unresolved and never reuses the proof',async()=>{
    const graph=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({id:'123456'}))).mockRejectedValueOnce(new Error('offline'));
    const uploaded=await uploadWhatsappMedia({...common,...file});if(!uploaded.ok)throw Error('fixture upload failed');
    expect(await sendWhatsappMedia({...common,media:uploaded.media})).toEqual({ok:false,code:'AMBIGUOUS',detail:'network'});
    expect(await sendWhatsappMedia({...common,media:uploaded.media})).toMatchObject({ok:false,detail:'media_binding_unconfirmed'});
    expect(graph).toHaveBeenCalledTimes(2);
  });
  it('does not accept a text-only Meta review grant for media',async()=>{
    vi.stubEnv('WHATSAPP_CONFIGURATION_MODE','meta_test');
    const graph=vi.spyOn(globalThis,'fetch');
    expect(await uploadWhatsappMedia({...common,...file})).toEqual({ok:false,code:'SEND_DISABLED'});
    expect(graph).not.toHaveBeenCalled();
  });
});

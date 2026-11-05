import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {createHash} from 'node:crypto';
import type {ReviewGrant} from '@/lib/meta-review/access';

const fixture = vi.hoisted(() => ({
  created: {} as Record<string, unknown>,
  claimed: {} as Record<string, unknown>,
  finalized: { error: null, data: {} } as { error: unknown; data: unknown },
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  capability: true as boolean | null,
  dispatch: null as { data: unknown; error: unknown } | null,
  throwDispatch: false,
  dispatchOnce: false, dispatchUsed: false,
  conversationVisible: true, queryFilters: [] as Array<[string, unknown]>,
  throwFinalizeOnce: false,
  windowOpen: true,
  vaultCompany: "company-offline-a",
  beforeVault: () => {},
  reviewGrant: null as ReviewGrant | null,
  media: null as Record<string,unknown> | null,
}));

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-offline-a", client_op_id: "offline-op-0001", company_id: "company-offline-a",
    conversation_id: "conversation-offline-a", phone_number_id: "100000000000001", recipient_wa_id: "10000000001",
    body: "Offline reply", sender_kind: "staff", outcome: "ready", wa_message_id: null, message_id: null,
    link_id: null, link_generation: null, expected_automation_generation: null, ...overrides,
  };
}
function paidAttestation() {
  return { company_id: "company-offline-a", environment: "live", plan_version_id: "plan-offline-a",
    paid_through: new Date(Date.now() + 3600_000).toISOString() };
}

vi.mock("@/lib/tenancy/access", () => ({
  getCompanyAccess: async () => ({ ok: true, context: {
    company: { id: "company-offline-a", status: "active" }, membership: { role: "staff" }, userId: "user-offline-a",
  } }),
}));
vi.mock("@/lib/access/actions", () => ({ sessionHasCompanyCapability: async () => fixture.capability }));
vi.mock('@/lib/meta-review/actions',()=>({readChannelReviewAccess:async()=>fixture.reviewGrant?{ok:true,grant:fixture.reviewGrant}:{ok:false}}));
vi.mock("@/lib/whatsapp/inbox", () => ({ loadWhatsappConversation: vi.fn(), loadWhatsappInbox: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    const query = {
      select: () => query, eq: (column: string, value: unknown) => { fixture.queryFilters.push([column, value]); return query; },
      maybeSingle: async () => table === "whatsapp_conversations" && fixture.conversationVisible ? { error: null, data: {
        id: "conversation-offline-a", company_id: "company-offline-a", phone_number_id: "100000000000001", customer_wa_id: "10000000001",
      } } : { error: null, data: null },
    };
    return query;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    fixture.calls.push({ name, args });
    if(name==='whatsapp_media_claimed_attachment')return {error:null,data:fixture.media};
    if (name === "whatsapp_authorize_staff_dispatch" || name === 'whatsapp_authorize_review_dispatch') {
      if (fixture.dispatchOnce) { if (fixture.dispatchUsed) return { error: null, data: { ok: false, code: "dispatch_already_authorized" } }; fixture.dispatchUsed = true; }
      if (fixture.throwDispatch) throw new Error("Synthetic dispatch transport uncertainty");
      return fixture.dispatch ?? { error: null, data: fixture.capability === true
        ? { ok: true, authorized: true, intent_id: "intent-offline-a" }
        : { ok: false, code: "staff_authority_revoked" } };
    }
    return { error: null, data: fixture.created };
  },
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    fixture.calls.push({ name, args });
    if (name === "resolve_whatsapp_company_by_provider_phone") return { error: null, data: { ok: true, eligible: true, company_id: "company-offline-a", link_id: "link-offline-a", generation: 1, provider_phone_number_id: "100000000000001", status: "verified" } };
    if (name === "whatsapp_check_service_window") { const at = new Date(Date.now() - 3600_000), until = new Date(at.getTime() + 86_400_000); return { error: null, data: { ok: fixture.windowOpen, company_id: "company-offline-a", conversation_id: "conversation-offline-a", phone_number_id: "100000000000001", recipient_wa_id: "10000000001", last_inbound_at: at.toISOString(), valid_until: until.toISOString() } }; }
    if (name === "whatsapp_read_link_access_secret") { fixture.beforeVault(); return { error: null, data: { ok: true, company_id: fixture.vaultCompany, link_id: "link-offline-a", link_generation: 1, phone_number_id: "100000000000001", access_token: "synthetic-company-vault-token" } }; }
    if (name === "whatsapp_revoke_failed_credential") return { error: null, data: true };
    if (name === "claim_whatsapp_send_attempt" || name === 'claim_whatsapp_review_send' || name === 'claim_whatsapp_media_send_attempt') return { error: null, data: fixture.claimed };
    if (name === "finalize_whatsapp_send_attempt") {
      if (fixture.throwFinalizeOnce) {
        fixture.throwFinalizeOnce = false;
        throw new Error("Offline RPC transport exception");
      }
      return fixture.finalized;
    }
    if (name === "retry_whatsapp_send_persist") return { error: null, data: { ok: true } };
    throw new Error(`Unexpected offline RPC ${name}`);
  },
}) }));

describe("real staff reply action at persistence and Graph boundaries", () => {
  beforeEach(() => {
    fixture.capability = true;
    fixture.reviewGrant = null;
    fixture.media = null;
    fixture.dispatch = null;
    fixture.throwDispatch = false; fixture.dispatchOnce = false; fixture.dispatchUsed = false; fixture.conversationVisible = true; fixture.queryFilters = [];
    fixture.throwFinalizeOnce = false;
    fixture.windowOpen = true;
    fixture.vaultCompany = "company-offline-a";
    fixture.beforeVault = () => {};
    fixture.calls = [];
    fixture.created = { ok: true, intent: intent() };
    fixture.claimed = { ok: true, claimed: true, attempt_token: "offline-claim-token", intent: intent({ outcome: "attempting" }), manual_paid_entitlement: paidAttestation() };
    fixture.finalized = { error: null, data: { ok: true, intent: intent({ outcome: "accepted", wa_message_id: "wamid.offline" }), message: {
      id: "message-offline-a", body: "Offline reply", received_at: "2026-10-08T00:00:00Z", delivery_state: "accepted",
    } } };
    vi.stubEnv("WHATSAPP_ROUTING_MODE", "single_tenant");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "offline-fixture-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "100000000000001");
    vi.stubEnv("WHATSAPP_COMPANY_ID", "company-offline-a");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.offline" }] })));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  const input = { conversationId: "conversation-offline-a", body: "Offline reply", clientOpId: "offline-op-0001" };
  it('sends a bound attachment without requiring a caption',async()=>{
    const file='44444444-4444-4444-8444-444444444444';
    fixture.created={ok:true,media_filename:'proof.pdf',intent:intent({body:'proof.pdf'})};
    fixture.claimed={ok:true,claimed:true,attempt_token:'offline-claim-token',intent:intent({body:'proof.pdf',outcome:'attempting'}),manual_paid_entitlement:paidAttestation()};
    fixture.media={ok:true,intentId:'intent-offline-a',attachmentId:file,filename:'proof.pdf',mime:'application/pdf',base64:'JVBERi0=',caption:''};
    const media=await import('./send');
    vi.spyOn(media,'uploadWhatsappMedia').mockResolvedValue({ok:true,media:{kind:'whatsapp-uploaded-media'}});
    const send=vi.spyOn(media,'sendWhatsappMedia').mockResolvedValue({ok:true,waMessageId:'wamid.offline'});
    const {replyWhatsappConversation}=await import('./actions');
    expect(await replyWhatsappConversation({...input,body:'',attachmentId:file})).toMatchObject({ok:true,outcome:'accepted'});
    expect(send).toHaveBeenCalledWith(expect.objectContaining({caption:''}));
  });
  it('rejects a captionless attachment if its claimed filename differs',async()=>{
    const file='44444444-4444-4444-8444-444444444444';
    fixture.created={ok:true,media_filename:'proof.pdf',intent:intent({body:'proof.pdf'})};
    fixture.claimed={ok:true,claimed:true,attempt_token:'offline-claim-token',intent:intent({body:'proof.pdf',outcome:'attempting'}),manual_paid_entitlement:paidAttestation()};
    fixture.media={ok:true,intentId:'intent-offline-a',attachmentId:file,filename:'other.pdf',mime:'application/pdf',base64:'JVBERi0=',caption:''};
    const media=await import('./send');const upload=vi.spyOn(media,'uploadWhatsappMedia');
    const {replyWhatsappConversation}=await import('./actions');
    await replyWhatsappConversation({...input,body:'',attachmentId:file});
    expect(upload).not.toHaveBeenCalled();
  });
  it('uses the native claimed media path before the final staff gate and sends once',async()=>{
    const file='44444444-4444-4444-8444-444444444444';
    fixture.media={ok:true,intentId:'intent-offline-a',attachmentId:file,filename:'proof.pdf',mime:'application/pdf',base64:'JVBERi0=',caption:input.body};
    const media=await import('./send');
    const proof={kind:'whatsapp-uploaded-media' as const};
    const upload=vi.spyOn(media,'uploadWhatsappMedia').mockImplementation(async()=>{fixture.calls.push({name:'media_upload',args:{}});return {ok:true,media:proof};});
    const send=vi.spyOn(media,'sendWhatsappMedia').mockImplementation(async()=>{fixture.calls.push({name:'media_send',args:{}});return {ok:true,waMessageId:'wamid.offline'};});
    const {replyWhatsappConversation}=await import('./actions');
    expect(await replyWhatsappConversation({...input,attachmentId:file})).toMatchObject({ok:true,outcome:'accepted'});
    const names=fixture.calls.map(call=>call.name);
    expect(names.indexOf('create_whatsapp_media_send_intent')).toBeLessThan(names.indexOf('claim_whatsapp_media_send_attempt'));
    expect(names.indexOf('claim_whatsapp_media_send_attempt')).toBeLessThan(names.indexOf('whatsapp_media_claimed_attachment'));
    expect(names.indexOf('whatsapp_media_claimed_attachment')).toBeLessThan(names.indexOf('media_upload'));
    expect(names.indexOf('media_upload')).toBeLessThan(names.indexOf('whatsapp_authorize_staff_dispatch'));
    expect(names.indexOf('whatsapp_authorize_staff_dispatch')).toBeLessThan(names.indexOf('media_send'));
    expect(upload).toHaveBeenCalledOnce();expect(send).toHaveBeenCalledOnce();expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('does not dispatch uploaded media when final staff authority is revoked',async()=>{
    const file='44444444-4444-4444-8444-444444444444';
    fixture.media={ok:true,intentId:'intent-offline-a',attachmentId:file,filename:'proof.pdf',mime:'application/pdf',base64:'JVBERi0=',caption:input.body};
    fixture.dispatch={error:null,data:{ok:false,code:'staff_authority_revoked'}};
    const media=await import('./send');
    vi.spyOn(media,'uploadWhatsappMedia').mockResolvedValue({ok:true,media:{kind:'whatsapp-uploaded-media'}});
    const send=vi.spyOn(media,'sendWhatsappMedia');
    const {replyWhatsappConversation}=await import('./actions');
    await replyWhatsappConversation({...input,attachmentId:file});
    expect(send).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('does not upload or dispatch a file whose durable binding differs',async()=>{
    const file='44444444-4444-4444-8444-444444444444';
    fixture.media={ok:true,intentId:'intent-offline-a',attachmentId:'55555555-5555-4555-8555-555555555555',filename:'proof.pdf',mime:'application/pdf',base64:'JVBERi0=',caption:input.body};
    fixture.finalized={error:null,data:{ok:true,intent:intent({outcome:'rejected'})}};
    const media=await import('./send');const upload=vi.spyOn(media,'uploadWhatsappMedia');const send=vi.spyOn(media,'sendWhatsappMedia');
    const {replyWhatsappConversation}=await import('./actions');await replyWhatsappConversation({...input,attachmentId:file});
    expect(upload).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
    expect(fixture.calls.some(c=>c.name==='whatsapp_authorize_staff_dispatch')).toBe(false);
  });
  it('never reaches the final gate or sends if media upload is uncertain',async()=>{
    const file='44444444-4444-4444-8444-444444444444';
    fixture.media={ok:true,intentId:'intent-offline-a',attachmentId:file,filename:'proof.pdf',mime:'application/pdf',base64:'JVBERi0=',caption:input.body};
    fixture.finalized={error:null,data:{ok:true,intent:intent({outcome:'rejected'})}};
    const media=await import('./send');vi.spyOn(media,'uploadWhatsappMedia').mockResolvedValue({ok:false,code:'AMBIGUOUS',detail:'upload_timeout'});
    const send=vi.spyOn(media,'sendWhatsappMedia');const {replyWhatsappConversation}=await import('./actions');
    await replyWhatsappConversation({...input,attachmentId:file});
    expect(send).not.toHaveBeenCalled();expect(fixture.calls.some(c=>c.name==='whatsapp_authorize_staff_dispatch')).toBe(false);
    expect(fixture.calls).toContainEqual({name:'finalize_whatsapp_send_attempt',args:{p_intent_id:'intent-offline-a',p_attempt_token:'offline-claim-token',p_result:'rejected',p_wa_message_id:null,p_error_code:'media_upload_failed',p_actor_user_id:'user-offline-a'}});
  });
  it('keeps the original media operation locked when dispatch authorization is uncertain',async()=>{
    const file='44444444-4444-4444-8444-444444444444';
    fixture.media={ok:true,intentId:'intent-offline-a',attachmentId:file,filename:'proof.pdf',mime:'application/pdf',base64:'JVBERi0=',caption:input.body};
    fixture.throwDispatch=true;
    const media=await import('./send');vi.spyOn(media,'uploadWhatsappMedia').mockResolvedValue({ok:true,media:{kind:'whatsapp-uploaded-media'}});
    const send=vi.spyOn(media,'sendWhatsappMedia');const {replyWhatsappConversation}=await import('./actions');
    expect(await replyWhatsappConversation({...input,attachmentId:file})).toMatchObject({ok:false,code:'UNKNOWN_OUTCOME',clientOpId:input.clientOpId});
    expect(send).not.toHaveBeenCalled();expect(fixture.calls.some(c=>c.name==='finalize_whatsapp_send_attempt')).toBe(false);
  });
  it('records an uncertain media send as unknown without dispatching a second message',async()=>{
    const file='44444444-4444-4444-8444-444444444444';
    fixture.media={ok:true,intentId:'intent-offline-a',attachmentId:file,filename:'proof.pdf',mime:'application/pdf',base64:'JVBERi0=',caption:input.body};
    const media=await import('./send');vi.spyOn(media,'uploadWhatsappMedia').mockResolvedValue({ok:true,media:{kind:'whatsapp-uploaded-media'}});
    const send=vi.spyOn(media,'sendWhatsappMedia').mockResolvedValue({ok:false,code:'AMBIGUOUS',detail:'network'});
    const {replyWhatsappConversation}=await import('./actions');
    expect(await replyWhatsappConversation({...input,attachmentId:file})).toMatchObject({ok:false,code:'UNKNOWN_OUTCOME',clientOpId:input.clientOpId});
    expect(send).toHaveBeenCalledOnce();expect(fixture.calls).toContainEqual({name:'finalize_whatsapp_send_attempt',args:{p_intent_id:'intent-offline-a',p_attempt_token:'offline-claim-token',p_result:'unknown',p_wa_message_id:null,p_error_code:'network',p_actor_user_id:'user-offline-a'}});
  });
  it.each(['allowed','wrong_body','wrong_recipient','revoked','dispatch_denied','missing_proof'] as const)('bounded manual permission with global sending off: %s',async scenario=>{
    vi.stubEnv('WHATSAPP_ALLOW_EXTERNAL_SEND','false');vi.stubEnv('WHATSAPP_ROUTING_MODE','tenant_registry');
    vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION','v26.0');
    fixture.reviewGrant={id:'grant-offline',channel:'whatsapp',app_id:'100',asset_id:'100000000000001',source_account_id:'200',recipient_ids:['10000000001'],send_limit:1,used_count:0,expires_at:new Date(Date.now()+60000).toISOString(),revoked_at:null,review_conversation_id:input.conversationId,review_link_id:'link-offline-a',review_link_generation:1,review_body_sha256:createHash('sha256').update(input.body).digest('hex')};
    fixture.created={ok:true,intent:intent({link_id:'link-offline-a',link_generation:1})};
    fixture.claimed={ok:true,claimed:true,attempt_token:'offline-claim-token',intent:intent({outcome:'attempting',link_id:'link-offline-a',link_generation:1}),review_entitlement:{grant_id:'grant-offline',company_id:'company-offline-a',channel:'whatsapp',asset_id:'100000000000001',expires_at:fixture.reviewGrant.expires_at}};
    fixture.dispatch={error:null,data:{ok:true,authorized:true,intent_id:'intent-offline-a',not_after:new Date(Date.now()+5000).toISOString()}};
    if(scenario==='wrong_body')fixture.reviewGrant.review_body_sha256='a'.repeat(64);
    if(scenario==='wrong_recipient')fixture.reviewGrant.recipient_ids=['10000000002'];
    if(scenario==='revoked')fixture.reviewGrant.revoked_at=new Date().toISOString();
    if(scenario==='dispatch_denied')fixture.dispatch={error:null,data:{ok:false,code:'dispatch_binding_mismatch'}};
    if(scenario==='missing_proof')delete fixture.claimed.review_entitlement;
    const {replyWhatsappConversation}=await import('./actions');await replyWhatsappConversation(input);
    expect(globalThis.fetch).toHaveBeenCalledTimes(scenario==='allowed'?1:0);
    expect(fixture.calls.some(c=>c.name==='claim_whatsapp_send_attempt')).toBe(false);
    if(scenario==='allowed')expect(fixture.calls.some(c=>c.name==='whatsapp_authorize_review_dispatch')).toBe(true);
  });
  it.each(["intent", "claim", "finalize"] as const)("bounds unknown %s RPC rejection details", async (stage) => {
    const rejection = { ok: false, code: "private schema diagnostic with synthetic secret" };
    if (stage === "intent") fixture.created = rejection;
    if (stage === "claim") fixture.claimed = rejection;
    if (stage === "finalize") fixture.finalized = { error: null, data: rejection };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "SAVE_FAILED", message: `${stage}_failed` });
    if (stage !== "finalize") expect(globalThis.fetch).not.toHaveBeenCalled();
    else expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
  it("denies reply and human control when capability lookup is unknown", async () => {
    fixture.capability = null;
    const { replyWhatsappConversation, controlWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await controlWhatsappConversation({ conversationId: input.conversationId, action: "resume", expectedRevision: 1 })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(fixture.calls).toHaveLength(0); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each([{label:"null",body:null},{label:"number",body:123},{label:"oversized",body:"x".repeat(4097)}])("rejects malformed or oversized human reply bodies before database or Graph: $label", async ({body}) => {
    const { replyWhatsappConversation } = await import("./actions");
    await expect(replyWhatsappConversation({ ...input, body: body as never })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(fixture.calls).toHaveLength(0); expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  function tenantReply() {
    vi.stubEnv("WHATSAPP_ROUTING_MODE", "tenant_registry");
    vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION", "v25.0");
    fixture.created = { ok: true, intent: intent({ link_id: "link-offline-a", link_generation: 1 }) };
    fixture.claimed = { ok: true, claimed: true, attempt_token: "offline-claim-token", intent: intent({ outcome: "attempting", link_id: "link-offline-a", link_generation: 1 }), manual_paid_entitlement: paidAttestation() };
  }
  it.each([
    undefined,
    null,
    { company_id: "company-offline-b", environment: "live", plan_version_id: "plan-offline-a", paid_through: "2099-01-01T00:00:00Z" },
    { company_id: "company-offline-a", environment: "test", plan_version_id: "plan-offline-a", paid_through: "2099-01-01T00:00:00Z" },
    { company_id: "company-offline-a", environment: "live", plan_version_id: "plan-offline-a", paid_through: "2020-01-01T00:00:00Z" },
    { company_id: "company-offline-a", environment: "live", plan_version_id: null, paid_through: "2099-01-01T00:00:00Z" },
    { company_id: "company-offline-a", environment: "live", plan_version_id: "plan-offline-a", paid_through: "invalid" },
  ])("rejects a newly claimed staff dispatch without a current company-bound Live paid attestation: %j", async (proof) => {
    tenantReply(); fixture.claimed.manual_paid_entitlement = proof;
    fixture.finalized = { error: null, data: { ok: true, intent: intent({ outcome: "rejected" }) } };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "REJECTED", outcome: "rejected", notAttempted: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(fixture.calls).toContainEqual({ name: "finalize_whatsapp_send_attempt", args: {
      p_intent_id: "intent-offline-a", p_attempt_token: "offline-claim-token", p_result: "rejected",
      p_wa_message_id: null, p_error_code: "paid_entitlement_unconfirmed", p_actor_user_id: "user-offline-a",
    } });
  });
  // Revocation after preparation must be rechecked at the final dispatch boundary.
  // The provider boundary is mocked; this never contacts Graph.
  it("staff revocation during Vault lookup blocks final Graph dispatch", async () => {
    tenantReply();
    fixture.beforeVault = () => { fixture.capability = false; };
    const { replyWhatsappConversation } = await import("./actions");
    await replyWhatsappConversation(input);
    expect(fixture.calls.some(c => c.name === "whatsapp_read_link_access_secret")).toBe(true);
    expect(fixture.capability).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each([
    { data: { ok: false, code: "dispatch_already_authorized" }, error: null },
    { data: { ok: true, authorized: false, intent_id: "intent-offline-a" }, error: null },
    { data: { ok: true, authorized: true, intent_id: "other-intent" }, error: null },
    { data: null, error: { code: "OFFLINE_RPC_TIMEOUT" } },
  ])("retains the existing attempt when final authorization is replayed or uncertain: %j", async (rpc) => {
    fixture.dispatch = rpc;
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "UNKNOWN_OUTCOME", clientOpId: input.clientOpId });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(fixture.calls.filter(c => c.name === "whatsapp_authorize_staff_dispatch")).toHaveLength(1);
    expect(fixture.calls.some(c => c.name === "finalize_whatsapp_send_attempt")).toBe(false);
  });
  it("does not retry or settle a thrown final authorization", async () => {
    fixture.throwDispatch = true;
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "UNKNOWN_OUTCOME" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(fixture.calls.filter(c => c.name === "whatsapp_authorize_staff_dispatch")).toHaveLength(1);
    expect(fixture.calls.some(c => c.name === "finalize_whatsapp_send_attempt")).toBe(false);
  });
  it("staff uses the exact company Vault token inside a persisted service window", async () => {
    tenantReply();
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: true, outcome: "accepted" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith("https://graph.facebook.com/v25.0/100000000000001/messages", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer synthetic-company-vault-token" }) }));
  });
  it("reports a paid claim denial without provider contact or allocating another operation", async () => {
    fixture.claimed = { ok: false, code: "subscription_inactive", intent: intent() };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "SUBSCRIPTION_INACTIVE",
      clientOpId: input.clientOpId, outcome: "ready", notAttempted: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(fixture.calls.filter(c => c.name === "finalize_whatsapp_send_attempt")).toHaveLength(0);
  });
  it("rechecks paid expiry after the window and Vault lookups immediately before Graph", async () => {
    tenantReply();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    fixture.claimed.manual_paid_entitlement = { ...paidAttestation(), paid_through: new Date(now + 1000).toISOString() };
    fixture.beforeVault = () => { clock.mockReturnValue(now + 1000); };
    fixture.finalized = { error: null, data: { ok: true, intent: intent({ outcome: "rejected" }) } };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "REJECTED", outcome: "rejected", notAttempted: true });
    expect(fixture.calls.some(c => c.name === "whatsapp_read_link_access_secret")).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("keeps the original operation unresolved if an old-schema paid-proof rejection cannot be persisted", async () => {
    delete fixture.claimed.manual_paid_entitlement;
    fixture.finalized = { error: { code: "OFFLINE_RPC_UNAVAILABLE" }, data: null };
    const { replyWhatsappConversation } = await import("./actions");
    const result = await replyWhatsappConversation(input);
    expect(result).toMatchObject({ ok: false, code: "SAVE_FAILED", outcome: "attempting", clientOpId: input.clientOpId });
    expect(result).not.toHaveProperty("notAttempted");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("staff cannot send outside the persisted customer window", async () => {
    tenantReply(); fixture.windowOpen = false;
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(fixture.calls.some(c => c.name === "whatsapp_read_link_access_secret")).toBe(false);
  });
  it("staff rejects a token returned for another company before Graph", async () => {
    tenantReply(); fixture.vaultCompany = "company-offline-b";
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("a confirmed expired Meta token invalidates only the credential that was dispatched", async () => {
    tenantReply();
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify({ error: { code: 190, message: "synthetic provider error" } }), { status: 401 }));
    fixture.finalized = { error: null, data: { ok: true, intent: intent({ outcome: "rejected" }) } };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "REJECTED", outcome: "rejected" });
    expect(fixture.calls).toContainEqual({ name: "finalize_whatsapp_send_attempt", args: { p_intent_id: "intent-offline-a", p_attempt_token: "offline-claim-token", p_result: "rejected", p_wa_message_id: null, p_error_code: "graph_190", p_actor_user_id: "user-offline-a" } });
    expect(fixture.calls.some(c => c.name === "whatsapp_revoke_failed_credential")).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { claimed: false },
    { claimed: undefined },
    { intent: null },
    { intent: intent({ outcome: "ready" }) },
    { attempt_token: "   " },
    { attempt_token: " offline-claim-token " },
  ])("requires an actual attempting claim before Graph: %j", async (override) => {
    fixture.claimed = { ...fixture.claimed, ...override };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, clientOpId: input.clientOpId });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { company_id: "company-offline-b" },
    { recipient_wa_id: "10000000002" },
    { body: "Different reply" },
    { id: "intent-offline-b" },
    { client_op_id: "offline-op-0002" },
    { conversation_id: "conversation-offline-b" },
    { sender_kind: "assistant" },
  ])("rejects changed claimed operation binding before Graph: %j", async (override) => {
    fixture.claimed = { ...fixture.claimed, intent: intent({ outcome: "attempting", ...override }) };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, clientOpId: input.clientOpId });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not replay acceptance belonging to a different company", async () => {
    fixture.created = { ok: true, intent: intent({ company_id: "company-offline-b", outcome: "accepted", wa_message_id: "wamid.foreign" }) };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "CONTENT_MISMATCH" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(fixture.calls.map((call) => call.name)).toEqual(["create_whatsapp_send_intent"]);
  });

  it("retains the same operation after provider timeout instead of resending", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(Object.assign(new Error("Offline timeout"), { name: "TimeoutError" }));
    const { replyWhatsappConversation } = await import("./actions");
    const result = await replyWhatsappConversation(input);
    expect(result).toMatchObject({ ok: false, code: "UNKNOWN_OUTCOME", outcome: "unknown", clientOpId: input.clientOpId });
    expect(fixture.calls.at(-1)?.args).toMatchObject({ p_result: "unknown", p_error_code: "timeout" });
    fixture.created = { ok: true, intent: intent({ outcome: "unknown" }) };
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "UNKNOWN_OUTCOME", clientOpId: input.clientOpId });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries acceptance persistence without a second provider send", async () => {
    fixture.finalized = { error: { code: "OFFLINE_RPC_TIMEOUT" }, data: null };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "UNKNOWN_OUTCOME", clientOpId: input.clientOpId });
    const finalizes = fixture.calls.filter((call) => call.name === "finalize_whatsapp_send_attempt");
    expect(finalizes).toHaveLength(2);
    expect(finalizes.map((call) => call.args.p_wa_message_id)).toEqual(["wamid.offline", "wamid.offline"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("recovers a thrown finalizer without replacing accepted evidence with unknown", async () => {
    fixture.throwFinalizeOnce = true;
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: true, outcome: "accepted" });
    const finalizes = fixture.calls.filter((call) => call.name === "finalize_whatsapp_send_attempt");
    expect(finalizes.map((call) => [call.args.p_result, call.args.p_wa_message_id]))
      .toEqual([["accepted", "wamid.offline"], ["accepted", "wamid.offline"]]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("requires reply capability before creating an intent or contacting Graph", async () => {
    fixture.capability = false;
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(fixture.calls).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("preserves provider accepted state separately from delivered", async () => {
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: true, outcome: "accepted", message: { deliveryState: "accepted" } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["dispatch_already_authorized", "staff_authority_revoked", "subscription_inactive", "SERVICE_NOT_ACTIVE"])("honors final dispatch denial after preparation: %s", async reason => {
    tenantReply();
    fixture.dispatch = { error: null, data: { ok: false, code: reason } };
    const { replyWhatsappConversation } = await import("./actions");
    const r = await replyWhatsappConversation(input);
    expect(r.ok).toBe(false); expect(r.clientOpId).toBe(input.clientOpId);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(fixture.calls.filter(c => c.name === "whatsapp_authorize_staff_dispatch")).toHaveLength(1);
    // No locally invented reject may release a hold when the final RPC denies/has ambiguous state.
    if (reason === "staff_authority_revoked") {
      expect(fixture.calls.filter(c => c.name === "finalize_whatsapp_send_attempt")).toHaveLength(1);
      expect(fixture.calls.find(c => c.name === "finalize_whatsapp_send_attempt")?.args).toMatchObject({ p_result: "rejected", p_error_code: reason });
    } else expect(fixture.calls.some(c => c.name === "finalize_whatsapp_send_attempt")).toBe(false);
  });
  it("concurrent replay reaches mocked atomic dispatch once and does not send twice", async () => {
    tenantReply();
    const fetch = vi.mocked(globalThis.fetch);
    fixture.dispatchOnce = true;
    const { replyWhatsappConversation } = await import("./actions");
    const results = await Promise.all([replyWhatsappConversation(input), replyWhatsappConversation(input)]);
    expect(results.some(r => r.ok === false)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(fixture.calls.filter(c => c.name === "finalize_whatsapp_send_attempt")).toHaveLength(1);
    expect(results.every(r => r.clientOpId === input.clientOpId)).toBe(true);
  });
  it.each(["unknown", "attempting"])("eight concurrent %s replays preserve operation without claim, release or send", async outcome => {
    fixture.created = { ok: true, intent: intent({ outcome }) };
    const { replyWhatsappConversation } = await import("./actions");
    const results = await Promise.all(Array.from({ length: 8 }, () => replyWhatsappConversation(input)));
    expect(results.every(r => !r.ok && r.clientOpId === input.clientOpId && !("notAttempted" in r))).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(fixture.calls.every(c => c.name === "create_whatsapp_send_intent")).toBe(true);
  });
  it("eight accepted replays do not claim or count a second send", async () => {
    fixture.created = { ok: true, intent: intent({ outcome: "accepted", wa_message_id: "wamid.offline", message_id: "message-offline-a" }) };
    const { replyWhatsappConversation } = await import("./actions");
    await Promise.all(Array.from({ length: 8 }, () => replyWhatsappConversation(input)));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(fixture.calls.some(c => c.name === "claim_whatsapp_send_attempt" || c.name === "finalize_whatsapp_send_attempt")).toBe(false);
  });

  it("assigned-only staff cannot reply when the session RLS read hides an unassigned conversation", async () => {
    fixture.conversationVisible = false;
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(fixture.queryFilters).toContainEqual(["company_id", "company-offline-a"]);
    expect(fixture.queryFilters).toContainEqual(["id", input.conversationId]);
    expect(fixture.calls).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

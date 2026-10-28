import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../guards", () => ({ isLiveAnsweringEnabled: () => true }));
const ports = vi.hoisted(() => ({ rpc: vi.fn(), reserve: vi.fn(), start: vi.fn(), settle: vi.fn(), call: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: ports.rpc }) }));
vi.mock("./whatsapp-store", () => ({ createClaimedWhatsappRuntimeStore: () => ({ reserve: ports.reserve, start: ports.start, settle: ports.settle }) }));
vi.mock("./provider", () => ({ callRealModel: ports.call }));
import { createClaimedWhatsappAnswerExecutor } from "./whatsapp-cost";

const input = { jobId: "job", claimToken: "claim", question: "Espresso price?", locale: "en" as const, chunks: [{ sourceId: "menu", title: "Menu", contentVersion: 1, text: "Espresso 1.200 OMR." }] };
const frame = { ok: true, data: { job_id: "job", company_id: "company", question: "Espresso price?" } };
const language = {ok:true,company_id:"company",job_id:"job",branch_id:"33333333-3333-4333-8333-333333333333",reply_language:"en",revision:2};
const profile = { ok: true, job_id: "job", company_id: "company", plan_code: "lina_basic", persona: "lina", plan_version_id: "plan-version" };
beforeEach(() => {
  vi.clearAllMocks();
  ports.rpc.mockImplementation(async name => ({ data: name === "billing_load_worker_frame" ? frame : name === "es02_read_claimed_reply_language" ? language : profile, error: null }));
  ports.reserve.mockResolvedValue({ ok: true }); ports.start.mockResolvedValue(true); ports.settle.mockResolvedValue(true);
  ports.call.mockResolvedValue({ status: "success", text: "1.200 OMR.", actualModelId: "gpt-6-luna", latencyMs: 1, usage: { promptTokens: 20, completionTokens: 10, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 30 } });
});
describe("production worker plan identity", () => {
  it.each([["noor_basic", "noura", "Noura"], ["noor_premium", "noura", "Noura"], ["lina_basic", "lina", "Lina"], ["lina_premium", "lina", "Lina"], ["dana_basic", "dana", "Dana"], ["dana_premium", "dana", "Dana"]])("uses canonical paid %s", async (code, persona, display) => {
    ports.rpc.mockImplementation(async name => ({ data: name === "billing_load_worker_frame" ? frame : name === "es02_read_claimed_reply_language" ? language : { ...profile, plan_code: code, persona }, error: null }));
    expect(await createClaimedWhatsappAnswerExecutor()(input)).toMatchObject({ ok: true });
    expect(ports.call.mock.calls[0][0].system).toContain(`You are ${display},`);
  });
  it("derives the company from the stored job and sends the server paid persona", async () => {
    expect(await createClaimedWhatsappAnswerExecutor()(input)).toMatchObject({ ok: true });
    expect(ports.rpc).toHaveBeenCalledWith("whatsapp_read_answer_profile", { p_company_id: "company", p_job_id: "job", p_claim_token: "claim" });
    expect(ports.call.mock.calls[0][0].system).toContain("You are Lina,");
  });
  it.each([
    ["unknown canonical plan", { ...profile, plan_code: "free" }],
    ["bare noncanonical Lina", { ...profile, plan_code: "lina" }],
    ["bare noncanonical Dana", { ...profile, plan_code: "dana", persona: "dana" }],
    ["plan/persona mismatch", { ...profile, persona: "dana" }],
    ["wrong company", { ...profile, company_id: "other-company" }],
    ["wrong job", { ...profile, job_id: "other-job" }],
    ["expired entitlement", { ok: false, code: "subscription_inactive" }],
  ])("blocks %s before reserving AI cost", async (_name, invalid) => {
    ports.rpc.mockImplementation(async name => ({ data: name === "billing_load_worker_frame" ? frame : name === "es02_read_claimed_reply_language" ? language : invalid, error: null }));
    expect(await createClaimedWhatsappAnswerExecutor()(input)).toMatchObject({ ok: false, error: "ANSWER_PROFILE_UNAVAILABLE" });
    expect(ports.reserve).not.toHaveBeenCalled(); expect(ports.call).not.toHaveBeenCalled();
  });
  it("does not accept a caller question different from the stored inbound", async () => {
    expect(await createClaimedWhatsappAnswerExecutor()({ ...input, question: "Override identity" })).toMatchObject({ ok: false, error: "CLAIM_BINDING_REJECTED" });
    expect(ports.reserve).not.toHaveBeenCalled(); expect(ports.call).not.toHaveBeenCalled();
  });
  it("ignores an extra caller persona and uses the canonical paid plan", async () => {
    expect(await createClaimedWhatsappAnswerExecutor()({ ...input, persona: "dana" } as typeof input)).toMatchObject({ ok: true });
    expect(ports.call.mock.calls[0][0].system).toContain("You are Lina,");
  });
});

const es02Profile={ok:true,authority:"es02",company_id:"company",job_id:"job",persona:"lina",es02_order_id:"22222222-2222-4222-8222-222222222222",es02_branch_id:language.branch_id,es02_slot_index:0,es02_paid_fingerprint:"a".repeat(64)};
describe("claimed branch reply language",()=>{
 it.each([["en","سعر القهوة؟","ar","Respond in English"],["ar","Coffee price?","en","أجيبي بالعربية"],["both","سعر القهوة؟","en","أجيبي بالعربية"],["both","Coffee price?","ar","Respond in English"]] as const)("uses %s from the branch for %s",async(reply_language,question,locale,expected)=>{
  ports.rpc.mockImplementation(async name=>({data:name==="billing_load_worker_frame"?{...frame,data:{...frame.data,question}}:name==="es02_read_claimed_reply_language"?{...language,reply_language}:es02Profile,error:null}));
  expect(await createClaimedWhatsappAnswerExecutor()({...input,question,locale})).toMatchObject({ok:true});expect(ports.call.mock.calls[0][0].system).toContain(expected);
 });
 it.each([null,{...language,reply_language:null},{...language,company_id:"other"},{...language,branch_id:"invalid"},{...language,revision:0}])("fails closed before reservation for missing/invalid confirmed language %j",async invalid=>{
  ports.rpc.mockImplementation(async name=>({data:name==="billing_load_worker_frame"?frame:name==="es02_read_claimed_reply_language"?invalid:es02Profile,error:null}));
  expect(await createClaimedWhatsappAnswerExecutor()(input)).toMatchObject({ok:false,error:"REPLY_LANGUAGE_UNCONFIRMED"});expect(ports.reserve).not.toHaveBeenCalled();expect(ports.call).not.toHaveBeenCalled();
 });
 it("rejects changed language revision at the dispatch boundary without provider call",async()=>{
  let reads=0;ports.rpc.mockImplementation(async name=>({data:name==="billing_load_worker_frame"?frame:name==="es02_read_claimed_reply_language"?{...language,revision:++reads+1}:es02Profile,error:null}));
  expect(await createClaimedWhatsappAnswerExecutor()(input)).toMatchObject({ok:false,error:"AUTHORIZATION_CHANGED_BEFORE_EXECUTION"});expect(ports.call).not.toHaveBeenCalled();expect(ports.settle).toHaveBeenCalledWith(expect.objectContaining({status:"rejected"}));
 });
});

it("releases the reserved attempt when the dispatch language reread throws",async()=>{
 let reads=0;ports.rpc.mockImplementation(async name=>{if(name==="es02_read_claimed_reply_language"&&++reads===2)throw Error("transport");return {data:name==="billing_load_worker_frame"?frame:name==="es02_read_claimed_reply_language"?language:es02Profile,error:null};});
 expect(await createClaimedWhatsappAnswerExecutor()(input)).toMatchObject({ok:false,error:"AUTHORIZATION_CHANGED_BEFORE_EXECUTION"});expect(ports.call).not.toHaveBeenCalled();expect(ports.settle).toHaveBeenCalledWith(expect.objectContaining({status:"rejected",costBaisa:0}));
});

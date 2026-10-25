import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const NONCE = "synthetic-request-nonce";
const INTENT = {
  id: "synthetic-signup-intent",
  stateNonce: "synthetic-state-nonce",
  browserLineageId: "synthetic-lineage",
};
const uid = "synthetic-user";

const mocks = vi.hoisted(() => ({
  signup: vi.fn(),
  loadIntent: vi.fn(),
  verify: vi.fn(),
  resend: vi.fn(),
  passwordLogin: vi.fn(),
  upsert: vi.fn(),
  cookie: vi.fn(),
  access: vi.fn(),
  createProvider: vi.fn(),
  prepare: vi.fn(),
  reserve: vi.fn(),
  claim: vi.fn(),
  admit: vi.fn(),
  cleanup: vi.fn(),
  bound: vi.fn(),
  member: vi.fn(),
  from: vi.fn(),
  commit: vi.fn(),
  intentCookie: vi.fn(),
  adminFrom: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: mocks.cookie,
    get: () => undefined,
    getAll: () => [],
    delete: mocks.cookie,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signUp: mocks.signup },
    from: () => ({ upsert: mocks.upsert }),
  }),
  createBrokerBoundClient: mocks.bound,
}));
vi.mock("@/lib/auth/broker/provider", () => ({ createProviderAuthClient: mocks.createProvider }));
vi.mock("@/lib/auth/broker/lineage-auth", () => ({ prepareBrokerAdmissionLineage: mocks.prepare }));
vi.mock("@/lib/auth/broker", () => ({
  admitNativeSession: mocks.admit,
  brokerPasswordLogin: mocks.passwordLogin,
  commitAuthReturnForGeneration: vi.fn(),
  resolveBrokerSession: vi.fn(),
  prepareBrokerAdmissionLineage: mocks.prepare,
  commitWorkspaceForGeneration: mocks.commit,
}));
vi.mock("@/lib/auth/broker/registry", () => ({
  reserveBoundAuthIntent: mocks.reserve,
  claimProviderAttempt: mocks.claim,
  probeBrokerCapability: async () => ({ ok: true, boundAdmit: true }),
  loadAuthIntentByNonce: mocks.loadIntent,
}));
vi.mock("@/lib/auth/broker/provider-session", () => ({
  signOutProviderSessionAfterAdmitFailure: mocks.cleanup,
}));
vi.mock("@/lib/auth/broker/cookies", () => ({ commitIntentCookie: mocks.intentCookie }));
vi.mock("@/lib/auth/broker/crypto", () => ({ encryptSecret: () => Buffer.from("enc") }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.adminFrom }),
}));
vi.mock("@/lib/tenancy/access", async (original) => ({
  ...await original<typeof import("./access")>(),
  getCompanyAccess: mocks.access,
}));

import { signInWithEmail, signUpWithEmail, verifyEmailCode, resendVerificationEmail, selectWorkspaceCompany } from "./actions";

const input = {
  name: "New Name",
  email: "qa@example.test",
  password: "test-password",
  confirmPassword: "test-password",
  requestNonce: NONCE,
};
const user = { id: uid, email: input.email, email_confirmed_at: null as string | null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadIntent.mockResolvedValue({...INTENT,purpose:"signup_email",status:"reserved",expiresAt:new Date(Date.now()+600_000).toISOString(),pkceVerifier:null});
  mocks.passwordLogin.mockResolvedValue({ok:false,code:"AUTH_ERROR"});
  mocks.createProvider.mockImplementation((options?: { persistPkceVerifier?: (v: string) => Promise<void> }) => ({
    client: { auth: { verifyOtp: mocks.verify, resend: mocks.resend, signUp: async (input: unknown) => {
      await options?.persistPkceVerifier?.("synthetic-verifier");
      return mocks.signup(input);
    } } },
    options,
  }));
  mocks.signup.mockResolvedValue({ data: { user, session: null }, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.prepare.mockResolvedValue({
    ok: true,
    bootstrapHash: "synthetic-root",
    browserLineageId: INTENT.browserLineageId,
  });
  mocks.reserve.mockResolvedValue(INTENT);
  mocks.claim.mockResolvedValue({ ok: true, claimed: true });
  mocks.admit.mockResolvedValue({ ok: true });
  mocks.cleanup.mockResolvedValue({ outcome: "confirmed", durable: true });
  const pkceChain = {
    update: () => pkceChain,
    eq: () => pkceChain,
    is: () => pkceChain,
    select: async () => ({ data: [{ id: INTENT.id }], error: null }),
  };
  mocks.adminFrom.mockReturnValue(pkceChain);
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: mocks.member,
  };
  mocks.from.mockReturnValue(query);
  mocks.member.mockResolvedValue({
    data: { company_id: "company-a", user_id: uid, status: "active" },
    error: null,
  });
  mocks.bound.mockResolvedValue({
    bound: {
      ok: true,
      client: { from: mocks.from },
      resolve: { boundary: { userId: uid, generation: "generation-a" } },
    },
  });
  mocks.commit.mockImplementation((store, generation, userId, companyId) => {
    store.set(`velora_ws_${generation}`, `${userId}:${companyId}`);
  });
});

describe("signup profile recovery without recreating Auth", () => {
  it("refuses signup without a request nonce before contacting Auth", async () => {
    const { requestNonce: _omit, ...withoutNonce } = input;
    expect(await signUpWithEmail(withoutNonce)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.signup).not.toHaveBeenCalled();
  });

  it("does not attempt a profile write before email verification", async () => {
    expect(await signUpWithEmail(input)).toMatchObject({ ok: true, data: { needsVerification: true } });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "signup_email", requestNonce: NONCE }),
    );
    expect(mocks.admit).not.toHaveBeenCalled();
    expect(mocks.signup).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: expect.stringContaining(`vel_intent=${encodeURIComponent(INTENT.stateNonce)}`),
        }),
      }),
    );
    expect(mocks.intentCookie).toHaveBeenCalledWith(expect.anything(), INTENT.stateNonce, 600);
  });

  it("keeps transport failures UNKNOWN without treating them as credential rejects", async () => {
    mocks.signup.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 503, code: "service_unavailable", message: "private upstream" },
    });
    expect(await signUpWithEmail(input)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.admit).not.toHaveBeenCalled();
  });

  it("clears an unconfirmed provider session and continues to verification", async () => {
    mocks.signup.mockResolvedValue({
      data: { user, session: { user } },
      error: null,
    });
    expect(await signUpWithEmail(input)).toMatchObject({
      ok: true,
      data: { needsVerification: true, email: input.email },
    });
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.admit).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("does not write a profile for the provider's obfuscated existing-user response", async () => {
    mocks.signup.mockResolvedValue({
      data: { user: { ...user, identities: [] }, session: null },
      error: null,
    });
    expect(await signUpWithEmail(input)).toMatchObject({ ok: true, data: { needsVerification: true } });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("handles an explicit existing account error with the same neutral verification flow", async () => {
    mocks.signup.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "user_already_exists", message: "private account information" },
    });
    expect(await signUpWithEmail(input)).toMatchObject({
      ok: true,
      data: { needsVerification: true, email: input.email },
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("inserts without replacing a persisted profile when a confirmed session is returned", async () => {
    const confirmed = { ...user, email_confirmed_at: "confirmed" };
    mocks.signup.mockResolvedValue({ data: { user: confirmed, session: { user: confirmed } }, error: null });
    expect(await signUpWithEmail(input)).toMatchObject({ ok: true, data: { needsVerification: false } });
    expect(mocks.admit).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: user.id, full_name: input.name },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  });

  it.each(["error", "throw"])("keeps the created Auth account recoverable on profile %s", async (mode) => {
    const confirmed = { ...user, email_confirmed_at: "confirmed" };
    mocks.signup.mockResolvedValue({ data: { user: confirmed, session: { user: confirmed } }, error: null });
    if (mode === "error") mocks.upsert.mockResolvedValue({ error: { code: "42501", message: "private persistence failure" } });
    else mocks.upsert.mockRejectedValue(new Error("private persistence failure"));
    const result = await signUpWithEmail(input);
    expect(result).toMatchObject({
      ok: true,
      data: { needsVerification: false, profilePending: true },
      diagnostic: { stage: "profile", code: "UNAVAILABLE" },
    });
    expect(JSON.stringify(result)).not.toContain("private persistence failure");
    expect(mocks.signup).toHaveBeenCalledTimes(1);
  });

  it("refuses to treat a mismatched session as a confirmed signup", async () => {
    mocks.signup.mockResolvedValue({
      data: {
        user: { ...user, email_confirmed_at: "confirmed" },
        session: { user: { ...user, id: "other" } },
      },
      error: null,
    });
    expect(await signUpWithEmail(input)).toMatchObject({ ok: false, code: "AUTH_ERROR" });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.admit).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("workspace selection resumes the selected role's journey", () => {
  const context = {
    userId: uid,
    needsProfileName: false,
    isPlatformAdmin: false,
    company: null,
    membership: null,
    needsCompanyContext: true,
    workspaceChoices: [{ companyId: "company-a" }],
  };

  it("validates the rendered account before changing the workspace cookie", async () => {
    mocks.access.mockResolvedValue({ ok: true, context });
    expect(await selectWorkspaceCompany("company-a", { expectedUserId: "other" })).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(mocks.cookie).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.bound).not.toHaveBeenCalled();
  });

  it("rechecks selection and returns setup with the saved subscription intent", async () => {
    mocks.access
      .mockResolvedValueOnce({ ok: true, context })
      .mockResolvedValueOnce({
        ok: true,
        context: {
          ...context,
          needsCompanyContext: false,
          company: { id: "company-a", status: "setup" },
          membership: { role: "owner" },
        },
      });
    const next = "/app/settings?tab=plan";
    expect(await selectWorkspaceCompany("company-a", { expectedUserId: uid, next })).toMatchObject({
      ok: true,
      data: { companyId: "company-a", next: `/setup?next=${encodeURIComponent(next)}` },
    });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.member).toHaveBeenCalledTimes(2);
  });

  it("sends staff to conversations even when the previous intent was setup", async () => {
    mocks.access
      .mockResolvedValueOnce({ ok: true, context })
      .mockResolvedValueOnce({
        ok: true,
        context: {
          ...context,
          needsCompanyContext: false,
          company: { id: "company-a", status: "setup" },
          membership: { role: "staff" },
        },
      });
    expect(await selectWorkspaceCompany("company-a", { expectedUserId: uid, next: "/setup" })).toMatchObject({
      ok: true,
      data: { next: "/app/conversations" },
    });
  });
});

it.each(['not-an-email','person@host','a'.repeat(255)+'@example.test'])('rejects malformed login email before the broker/provider boundary: %s',async email=>{
 expect(await signInWithEmail({email,password:'synthetic-fixture-only',requestNonce:NONCE})).toMatchObject({ok:false,code:'INVALID_INPUT'});expect(mocks.passwordLogin).not.toHaveBeenCalled();
});
it('normalizes a valid login email and preserves existing password handling',async()=>{
 expect(await signInWithEmail({email:'  QA@EXAMPLE.TEST  ',password:'x',requestNonce:NONCE})).toMatchObject({ok:false,code:'AUTH_ERROR'});expect(mocks.passwordLogin).toHaveBeenCalledWith(expect.objectContaining({email:'qa@example.test',password:'x'}));
});

const correlation={request_id:'VEL-0123456789ABCDEF',trace_id:'1234567890abcdef1234567890abcdef',parent_span_id:'1234567890abcdef'};
it('keeps login diagnostics linked to the browser packet without changing invalid-credential behavior',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});
 try{const result=await signInWithEmail({...input,correlation});expect(result).toMatchObject({ok:false,code:'AUTH_ERROR',diagnostic:{reference:correlation.request_id}});const rows=info.mock.calls.map(([row])=>JSON.parse(String(row)));expect(rows.every(row=>row.trace_id===correlation.trace_id)).toBe(true);expect(rows.at(-1).parent_span_id).toBe(correlation.parent_span_id);}finally{info.mockRestore();}
});
it('fails closed on provider-reported expiry (mocked provider contract)',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});
 mocks.verify.mockResolvedValue({data:{user:null,session:null},error:{code:'otp_expired',status:403,message:'sensitive provider payload'}});
 try{const result=await verifyEmailCode({email:input.email,code:'012345',requestNonce:NONCE,correlation});expect(result).toMatchObject({ok:false,code:'AUTH_ERROR',message:'verification_code_invalid',diagnostic:{reference:correlation.request_id}});expect(mocks.admit).not.toHaveBeenCalled();expect(mocks.access).not.toHaveBeenCalled();expect(mocks.upsert).not.toHaveBeenCalled();const text=JSON.stringify(info.mock.calls);expect(info.mock.calls.some(([line])=>Object.values(JSON.parse(String(line))).includes('012345'))).toBe(false);expect(text).not.toContain(input.email);expect(text).not.toContain('sensitive provider payload');}finally{info.mockRestore();}
});
it('distinguishes uncertain verification transport in logs without admitting a session',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});mocks.verify.mockRejectedValue(Error('private network payload'));
 try{expect(await verifyEmailCode({email:input.email,code:'012345',requestNonce:NONCE,correlation})).toMatchObject({ok:false,code:'UNAVAILABLE',message:'verification_unavailable'});expect(mocks.admit).not.toHaveBeenCalled();expect(JSON.stringify(info.mock.calls)).toContain('OUTCOME_UNKNOWN');expect(JSON.stringify(info.mock.calls)).not.toContain('private network payload');}finally{info.mockRestore();}
});
it('links a resend provider rate rejection and never logs the mailbox',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});mocks.loadIntent.mockResolvedValue({...INTENT,purpose:'signup_resend',status:'reserved',expiresAt:new Date(Date.now()+600_000).toISOString(),pkceVerifier:null});mocks.resend.mockResolvedValue({error:{status:429}});
 try{expect(await resendVerificationEmail(input.email,null,NONCE,correlation)).toMatchObject({ok:false,message:'verification_rate_limited',diagnostic:{reference:correlation.request_id}});expect(JSON.stringify(info.mock.calls)).not.toContain(input.email);}finally{info.mockRestore();}
});

it('correlates a thrown signup as UNKNOWN without exposing the error payload',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});mocks.signup.mockRejectedValue(Error('private signup transport'));
 try{expect(await signUpWithEmail({...input,correlation})).toMatchObject({ok:false,code:'UNAVAILABLE',diagnostic:{code:'OUTCOME_UNKNOWN',reference:correlation.request_id}});expect(JSON.stringify(info.mock.calls)).not.toContain('private signup transport');expect(mocks.admit).not.toHaveBeenCalled();}finally{info.mockRestore();}
});
it('records unknown cleanup after a rejected confirmed-session admission without claiming signup success',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});const confirmed={...user,email_confirmed_at:'confirmed'};mocks.signup.mockResolvedValue({data:{user:confirmed,session:{user:confirmed}},error:null});mocks.admit.mockResolvedValue({ok:false});mocks.cleanup.mockResolvedValue({outcome:'unknown',durable:false});
 try{expect(await signUpWithEmail({...input,correlation})).toMatchObject({ok:false,code:'UNAVAILABLE',message:'PROVIDER_CLEANUP_UNKNOWN',diagnostic:{code:'OUTCOME_UNKNOWN'}});expect(mocks.upsert).not.toHaveBeenCalled();}finally{info.mockRestore();}
});

it('rejects simulated OTP reuse after a confirmed verification without admitting a second session',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});const confirmed={...user,email_confirmed_at:'confirmed'};
 mocks.verify.mockResolvedValueOnce({data:{user:confirmed,session:{user:confirmed}},error:null}).mockResolvedValueOnce({data:{user:null,session:null},error:{code:'otp_expired',status:403}});
 mocks.admit.mockResolvedValue({ok:true,committed:{boundaryFingerprint:'aaaaaaaaaaaaaaaa'}});mocks.access.mockResolvedValue({ok:true,context:{userId:uid,isPlatformAdmin:false,needsProfileName:true}});
 try{const first=await verifyEmailCode({email:input.email,code:'012345',requestNonce:NONCE,correlation});expect(first).toMatchObject({ok:true,data:{userId:uid,next:'/complete-profile'}});const replay=await verifyEmailCode({email:input.email,code:'012345',requestNonce:NONCE+'-new-gesture',correlation});expect(replay).toMatchObject({ok:false,code:'AUTH_ERROR',message:'verification_code_invalid'});expect(mocks.verify).toHaveBeenCalledTimes(2);expect(mocks.admit).toHaveBeenCalledTimes(1);expect(mocks.access).toHaveBeenCalledTimes(1);}finally{info.mockRestore();}
});
it('stops a previously claimed verification intent before another native OTP request',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});mocks.claim.mockResolvedValue({ok:true,claimed:false});
 try{expect(await verifyEmailCode({email:input.email,code:'012345',requestNonce:NONCE,correlation})).toMatchObject({ok:false,code:'UNAVAILABLE'});expect(mocks.verify).not.toHaveBeenCalled();expect(mocks.admit).not.toHaveBeenCalled();}finally{info.mockRestore();}
});

it('records a thrown password-login outcome as UNKNOWN with the same root reference',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});mocks.passwordLogin.mockRejectedValue(Error('private login transport'));
 try{expect(await signInWithEmail({...input,correlation})).toMatchObject({ok:false,code:'UNAVAILABLE',diagnostic:{reference:correlation.request_id,code:'OUTCOME_UNKNOWN'}});expect(mocks.access).not.toHaveBeenCalled();expect(JSON.stringify(info.mock.calls)).not.toContain('private login transport');}finally{info.mockRestore();}
});

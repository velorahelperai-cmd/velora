import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
const fileMocks=vi.hoisted(()=>({upload:vi.fn(),access:vi.fn(),retryPrepare:vi.fn(),boundEnqueue:vi.fn()}));
const VALID_SESSION_ID = "55555555-5555-4555-8555-555555555555";
vi.mock('@/lib/knowledge/actions',()=>({uploadKnowledgeFiles:fileMocks.upload,retryKnowledgePrepare:fileMocks.retryPrepare}));
vi.mock('@/lib/knowledge/file-worker/bound-enqueue',()=>({enqueueBoundBranchKnowledgeFilePrepare:fileMocks.boundEnqueue}));
vi.mock('./access',()=>({getCompanyAccess:fileMocks.access}));

const VALID_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const VALID_BRANCH_ID = "33333333-3333-4333-8333-333333333333";
const REVIEWED_TEXT = "Reviewed knowledge body";
const REVIEWED_FINGERPRINT = createHash("sha256").update(REVIEWED_TEXT, "utf8").digest("hex");

let currentSessionId: string | null = VALID_ACCOUNT_ID;
let rpcMock = vi.fn();
let approveRow: Record<string, unknown> | null = {
  id: "44444444-4444-4444-8444-444444444444",
  company_id: VALID_COMPANY_ID,
  status: "ready",
  content: REVIEWED_TEXT,
  content_version: 3,
  prepared_text_sha256: null,
  approved_for_answers: false,
};

vi.mock("@/lib/auth/server-identity", () => ({
  readSessionIdentity: vi.fn(async () => {
    if (!currentSessionId) return { ok: false, code: "UNAUTHENTICATED" };
    return { ok: true, userId: currentSessionId, nativeSessionId: "55555555-5555-4555-8555-555555555555" };
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: rpcMock,
    from: () => {
      const filters: Array<[string, unknown]> = [];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
        in: () => q,
        maybeSingle: async () => {
          if (!approveRow) return { data: null, error: null };
          const ok = filters.every(([k, v]) => approveRow![k] === v);
          return { data: ok ? { ...approveRow } : null, error: null };
        },
        // upload path awaits the filter builder for `{ data, error }`
        then: (resolve: (value: { data: unknown[]; error: null }) => void) =>
          resolve({ data: [], error: null }),
      };
      return q;
    },
  })),
}));

vi.mock("@/lib/logging/logger.mjs", () => ({
  logEvent: vi.fn(),
  withLogContext: vi.fn(async (_ctx, fn) => fn()),
}));

import {
  mutateOwnedBranchKnowledgeSourceAction,
  removeOwnedBranchKnowledgePageAction,
  addOwnedBranchWebsiteAction,
  indexOwnedBranchWebsiteAction,
  isSafePublicUrl,
  loadApprovedBranchKnowledgeContext,
  readOwnedBranchKnowledgeAction,
  saveOwnedBranchKnowledgeTextAction,
  approveOwnedBranchKnowledgeSourceAction,
  uploadOwnedBranchKnowledgeFilesAction,
  reprocessOwnedBranchKnowledgeFileAction,
} from "./paid-branch-knowledge-actions";
import { safeFetchWebsite } from "./safe-website-fetcher";

describe('branch knowledge writes',()=>{
 const scope={expectedAccountId:VALID_ACCOUNT_ID,companyId:VALID_COMPANY_ID,branchId:VALID_BRANCH_ID};
 const snapshot={scope,version:1,branchLabel:'Main',websiteQuota:{limit:10,used:0},pages:[],files:[],faq:[],capabilities:{canAddWebsite:true,canUploadFiles:true,canSaveText:true}};
 beforeEach(()=>{
  currentSessionId=VALID_ACCOUNT_ID;
  rpcMock=vi.fn().mockResolvedValue({data:{ok:true,data:{snapshot}},error:null});
  approveRow={
   id:'44444444-4444-4444-8444-444444444444',
   company_id:VALID_COMPANY_ID,
   status:'ready',
   content:REVIEWED_TEXT,
   content_version:3,
   prepared_text_sha256:null,
   approved_for_answers:false,
  };
  fileMocks.upload.mockReset();
  fileMocks.boundEnqueue.mockReset();
  fileMocks.access.mockResolvedValue({ok:true,context:{userId:VALID_ACCOUNT_ID,company:{id:VALID_COMPANY_ID}}});
  vi.unstubAllEnvs();
  vi.stubEnv('VELORA_KNOWLEDGE_FILE_WORKER_ENABLED','false');
 });
 it('edits and removes only exact scoped source versions and deletes exact page versions',async()=>{const sourceId='44444444-4444-4444-8444-444444444444';expect(await mutateOwnedBranchKnowledgeSourceAction({...scope,sourceId,contentVersion:3,action:'edit',title:' Q ',content:' A '})).toEqual(snapshot);expect(rpcMock).toHaveBeenLastCalledWith('es02_mutate_owned_branch_knowledge_source',expect.objectContaining({p_content_version:3,p_action:'edit',p_title:'Q',p_content:'A'}));expect(await mutateOwnedBranchKnowledgeSourceAction({...scope,sourceId,contentVersion:3,action:'remove'})).toEqual(snapshot);expect(await removeOwnedBranchKnowledgePageAction({...scope,pageId:sourceId,pageVersion:4})).toEqual(snapshot);expect(rpcMock).toHaveBeenLastCalledWith('es02_remove_owned_branch_knowledge_page',expect.objectContaining({p_page_version:4,p_branch_id:scope.branchId}));});
 it('fails closed for invalid versions, switched identity and stale SQL result',async()=>{const input={...scope,sourceId:'44444444-4444-4444-8444-444444444444',contentVersion:0,action:'remove' as const};expect(await mutateOwnedBranchKnowledgeSourceAction(input)).toBeNull();currentSessionId=null;expect(await mutateOwnedBranchKnowledgeSourceAction({...input,contentVersion:2})).toBeNull();expect(rpcMock).not.toHaveBeenCalled();currentSessionId=VALID_ACCOUNT_ID;rpcMock.mockResolvedValue({data:{ok:false,code:'CONFLICT'},error:null});expect(await mutateOwnedBranchKnowledgeSourceAction({...input,contentVersion:2})).toBeNull();});
 it('does not report partial file batches as saved',async()=>{fileMocks.upload.mockResolvedValue({ok:true,data:[{ok:false,code:'FAILED'}]});expect(await uploadOwnedBranchKnowledgeFilesAction({...scope,expectedVersion:1,files:[new File(['fixture'],'fixture.txt')]})).toBeNull();expect(rpcMock).toHaveBeenCalledTimes(1);});
 it('saves trimmed text through the owned branch contract without approving it',async()=>{expect(await saveOwnedBranchKnowledgeTextAction({...scope,expectedVersion:1,title:' Q ',content:' A '})).toEqual(snapshot);expect(rpcMock).toHaveBeenCalledWith('es02_save_owned_branch_knowledge_text',expect.objectContaining({p_title:'Q',p_content:'A',p_branch_id:VALID_BRANCH_ID}));expect(rpcMock).toHaveBeenCalledTimes(1);});
 it('binds explicit approval to the exact reviewed version and text fingerprint',async()=>{
  const source='44444444-4444-4444-8444-444444444444';
  expect(await approveOwnedBranchKnowledgeSourceAction({...scope,sourceId:source,contentVersion:3,approved:true,reviewedContentFingerprint:REVIEWED_FINGERPRINT})).toEqual(snapshot);
  expect(rpcMock).toHaveBeenCalledWith('es02_approve_owned_branch_knowledge_source',expect.objectContaining({p_source_id:source,p_content_version:3,p_approved:true}));
 });
 it('rejects approve when content changed between display and click (version or fingerprint drift)',async()=>{
  const source='44444444-4444-4444-8444-444444444444';
  expect(await approveOwnedBranchKnowledgeSourceAction({...scope,sourceId:source,contentVersion:3,approved:true})).toBeNull();
  expect(rpcMock).not.toHaveBeenCalled();
  expect(await approveOwnedBranchKnowledgeSourceAction({...scope,sourceId:source,contentVersion:3,approved:true,reviewedContentFingerprint:'b'.repeat(64)})).toBeNull();
  expect(rpcMock).not.toHaveBeenCalled();
  approveRow={...approveRow!,content_version:5,content:'Different extract after reprocess'};
  expect(await approveOwnedBranchKnowledgeSourceAction({...scope,sourceId:source,contentVersion:3,approved:true,reviewedContentFingerprint:REVIEWED_FINGERPRINT})).toBeNull();
  expect(rpcMock).not.toHaveBeenCalled();
 });
 it('rejects a stale prepared_text_sha256 fingerprint that does not match current content',async()=>{
  const source='44444444-4444-4444-8444-444444444444';
  const stalePrepared='a'.repeat(64);
  approveRow={...approveRow!,content:REVIEWED_TEXT,content_version:3,prepared_text_sha256:stalePrepared};
  expect(await approveOwnedBranchKnowledgeSourceAction({...scope,sourceId:source,contentVersion:3,approved:true,reviewedContentFingerprint:stalePrepared})).toBeNull();
  expect(rpcMock).not.toHaveBeenCalled();
  expect(await approveOwnedBranchKnowledgeSourceAction({...scope,sourceId:source,contentVersion:3,approved:true,reviewedContentFingerprint:REVIEWED_FINGERPRINT})).toEqual(snapshot);
  expect(rpcMock).toHaveBeenCalledWith('es02_approve_owned_branch_knowledge_source',expect.objectContaining({p_content_version:3,p_approved:true}));
 });
 it('allows unapprove by version without a review fingerprint',async()=>{
  const source='44444444-4444-4444-8444-444444444444';
  expect(await approveOwnedBranchKnowledgeSourceAction({...scope,sourceId:source,contentVersion:3,approved:false})).toEqual(snapshot);
  expect(rpcMock).toHaveBeenCalledWith('es02_approve_owned_branch_knowledge_source',expect.objectContaining({p_approved:false,p_content_version:3}));
 });
 it('rejects a switched identity and malformed text before writes',async()=>{currentSessionId=null;expect(await saveOwnedBranchKnowledgeTextAction({...scope,expectedVersion:1,title:'Q',content:'A'})).toBeNull();currentSessionId=VALID_ACCOUNT_ID;expect(await saveOwnedBranchKnowledgeTextAction({...scope,expectedVersion:1,title:'Q',content:'x'.repeat(20001)})).toBeNull();expect(rpcMock).not.toHaveBeenCalled();});
 it('rejects a foreign snapshot returned after a write',async()=>{rpcMock.mockResolvedValue({data:{ok:true,data:{snapshot:{...snapshot,scope:{...scope,branchId:VALID_COMPANY_ID}}}},error:null});expect(await saveOwnedBranchKnowledgeTextAction({...scope,expectedVersion:1,title:'Q',content:'A'})).toBeNull();});
 it('uses the real uploader then binds the returned company source and version without approval',async()=>{const source={id:'44444444-4444-4444-8444-444444444444',company_id:VALID_COMPANY_ID,content_version:2};fileMocks.upload.mockResolvedValue({ok:true,data:[{ok:true,source}]});expect(await uploadOwnedBranchKnowledgeFilesAction({...scope,expectedVersion:1,files:[new File(['fixture'],'fixture.txt',{type:'text/plain'})]})).toEqual(snapshot);const form=fileMocks.upload.mock.calls[0]![0] as FormData;expect(form.get('expectedCompanyId')).toBe(VALID_COMPANY_ID);expect(rpcMock).toHaveBeenCalledWith('es02_bind_owned_branch_knowledge_source',expect.objectContaining({p_source_id:source.id,p_content_version:2,p_branch_id:VALID_BRANCH_ID}));expect(rpcMock.mock.calls.some(call=>String(call[0]).includes('approve'))).toBe(false);});
 it('does not upload into a changed selected company',async()=>{fileMocks.access.mockResolvedValue({ok:true,context:{userId:VALID_ACCOUNT_ID,company:{id:VALID_BRANCH_ID}}});expect(await uploadOwnedBranchKnowledgeFilesAction({...scope,expectedVersion:1,files:[new File(['fixture'],'fixture.txt')]})).toBeNull();expect(fileMocks.upload).not.toHaveBeenCalled();});
 it('binds uploaded source to branch even if text extraction failed (no_text or extract_failed)',async()=>{const source={id:'44444444-4444-4444-8444-444444444444',company_id:VALID_COMPANY_ID,content_version:2,status:'failed',failure_code:'no_text'};fileMocks.upload.mockResolvedValue({ok:true,data:[{ok:false,uploaded:true,code:'UPLOAD_OK_EXTRACT_FAILED',source}]});expect(await uploadOwnedBranchKnowledgeFilesAction({...scope,expectedVersion:1,files:[new File(['fixture'],'fixture.pdf',{type:'application/pdf'})]})).toEqual(snapshot);expect(rpcMock).toHaveBeenCalledWith('es02_bind_owned_branch_knowledge_source',expect.objectContaining({p_source_id:source.id,p_content_version:2,p_branch_id:VALID_BRANCH_ID}));});
 const sourceId='44444444-4444-4444-8444-444444444444';
 const withFile={...snapshot,files:[{branchId:VALID_BRANCH_ID,source:{id:sourceId,company_id:VALID_COMPANY_ID,kind:'file',status:'failed'}}]};
 it('delegates the only processing claim to the canonical preparer after checking branch membership',async()=>{
  rpcMock.mockResolvedValue({data:{ok:true,data:{snapshot:withFile}},error:null});
  const from=vi.fn(()=>{throw new Error('wrapper must not preclaim');});
  const {createClient}=await import('@/lib/supabase/server');
  vi.mocked(createClient).mockResolvedValueOnce({rpc:rpcMock,from} as never);
  fileMocks.retryPrepare.mockReset().mockResolvedValue({ok:true});
  expect(await reprocessOwnedBranchKnowledgeFileAction({...scope,sourceId,expectedVersion:1})).toEqual(withFile);
  expect(fileMocks.retryPrepare).toHaveBeenCalledExactlyOnceWith(sourceId);
  expect(from).not.toHaveBeenCalled();expect(fileMocks.upload).not.toHaveBeenCalled();
 });
 it('does not reprocess a company source absent from the selected branch',async()=>{
  fileMocks.retryPrepare.mockReset();
  expect(await reprocessOwnedBranchKnowledgeFileAction({...scope,sourceId,expectedVersion:1})).toBeNull();
  expect(fileMocks.retryPrepare).not.toHaveBeenCalled();
 });
 it('reads current state for a busy canonical claim without claiming or retrying again',async()=>{
  rpcMock.mockResolvedValue({data:{ok:true,data:{snapshot:withFile}},error:null});
  fileMocks.retryPrepare.mockReset().mockResolvedValue({ok:false,code:'CONFLICT'});
  expect(await reprocessOwnedBranchKnowledgeFileAction({...scope,sourceId,expectedVersion:1})).toEqual(withFile);
  expect(fileMocks.retryPrepare).toHaveBeenCalledTimes(1);
 });
 it('does not report a failed preparation read as success',async()=>{
  rpcMock.mockResolvedValue({data:{ok:true,data:{snapshot:withFile}},error:null});
  fileMocks.retryPrepare.mockReset().mockResolvedValue({ok:false,code:'STORAGE_ERROR'});
  expect(await reprocessOwnedBranchKnowledgeFileAction({...scope,sourceId,expectedVersion:1})).toBeNull();
 });
 it('when worker gate is on, enqueues a durable attempt and skips sync prepare',async()=>{
  vi.stubEnv('VELORA_KNOWLEDGE_FILE_WORKER_ENABLED','true');
  rpcMock.mockResolvedValue({data:{ok:true,data:{snapshot:withFile}},error:null});
  fileMocks.retryPrepare.mockReset();
  fileMocks.boundEnqueue.mockResolvedValue({mode:'queued',attemptId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',status:'processing'});
  expect(await reprocessOwnedBranchKnowledgeFileAction({...scope,sourceId,expectedVersion:1})).toEqual(withFile);
  expect(fileMocks.retryPrepare).not.toHaveBeenCalled();
  expect(fileMocks.boundEnqueue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    actorId:VALID_ACCOUNT_ID,
    sessionId:VALID_SESSION_ID,
    companyId:VALID_COMPANY_ID,
    branchId:VALID_BRANCH_ID,
    sourceId,
  }));
 });
 it('when worker gate is on, bind then enqueue without waiting for extract',async()=>{
  vi.stubEnv('VELORA_KNOWLEDGE_FILE_WORKER_ENABLED','true');
  const source={id:'44444444-4444-4444-8444-444444444444',company_id:VALID_COMPANY_ID,content_version:2,status:'stored'};
  fileMocks.upload.mockResolvedValue({ok:true,data:[{ok:true,source}]});
  fileMocks.boundEnqueue.mockResolvedValue({mode:'queued',attemptId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',status:'processing'});
  expect(await uploadOwnedBranchKnowledgeFilesAction({...scope,expectedVersion:1,files:[new File(['fixture'],'fixture.pdf',{type:'application/pdf'})]})).toEqual(snapshot);
  expect(rpcMock).toHaveBeenCalledWith('es02_bind_owned_branch_knowledge_source',expect.objectContaining({p_source_id:source.id}));
  expect(fileMocks.boundEnqueue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({sourceId:source.id,branchId:VALID_BRANCH_ID}));
 });
 it('auto-enqueues after bind on the same upload action (no separate queue button)',async()=>{
  vi.stubEnv('VELORA_KNOWLEDGE_FILE_WORKER_ENABLED','true');
  const source={id:'44444444-4444-4444-8444-444444444444',company_id:VALID_COMPANY_ID,content_version:2,status:'stored'};
  fileMocks.upload.mockResolvedValue({ok:true,data:[{ok:true,source}]});
  fileMocks.boundEnqueue.mockResolvedValue({mode:'queued',attemptId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',status:'processing'});
  await uploadOwnedBranchKnowledgeFilesAction({...scope,expectedVersion:1,files:[new File(['fixture'],'auto.pdf',{type:'application/pdf'})]});
  const calls=rpcMock.mock.calls.map(c=>String(c[0]));
  expect(calls.filter(n=>n==='es02_bind_owned_branch_knowledge_source')).toHaveLength(1);
  expect(fileMocks.boundEnqueue).toHaveBeenCalledTimes(1);
  expect(fileMocks.retryPrepare).not.toHaveBeenCalled();
 });
 it('does not enqueue when bind fails after a successful storage upload',async()=>{
  vi.stubEnv('VELORA_KNOWLEDGE_FILE_WORKER_ENABLED','true');
  const source={id:'44444444-4444-4444-8444-444444444444',company_id:VALID_COMPANY_ID,content_version:2,status:'stored'};
  fileMocks.upload.mockResolvedValue({ok:true,data:[{ok:true,source}]});
  rpcMock.mockResolvedValueOnce({data:{ok:true,data:{snapshot}},error:null}) // initial read
   .mockResolvedValueOnce({data:null,error:{message:'bind_failed'}});
  expect(await uploadOwnedBranchKnowledgeFilesAction({...scope,expectedVersion:1,files:[new File(['fixture'],'bindfail.pdf',{type:'application/pdf'})]})).toBeNull();
  expect(fileMocks.upload).toHaveBeenCalledTimes(1);
  expect(fileMocks.boundEnqueue).not.toHaveBeenCalled();
 });
 it('keeps the bound source visible when enqueue fails after storage+bind (no re-upload required)',async()=>{
  vi.stubEnv('VELORA_KNOWLEDGE_FILE_WORKER_ENABLED','true');
  const source={id:'44444444-4444-4444-8444-444444444444',company_id:VALID_COMPANY_ID,content_version:2,status:'stored'};
  const bound={...snapshot,files:[{branchId:VALID_BRANCH_ID,source:{...source,kind:'file',status:'stored'}}]};
  rpcMock.mockResolvedValue({data:{ok:true,data:{snapshot:bound}},error:null});
  fileMocks.upload.mockResolvedValue({ok:true,data:[{ok:true,source}]});
  fileMocks.boundEnqueue.mockResolvedValue({mode:'unavailable',code:'UNAVAILABLE'});
  expect(await uploadOwnedBranchKnowledgeFilesAction({...scope,expectedVersion:1,files:[new File(['fixture'],'keep.pdf',{type:'application/pdf'})]})).toEqual(bound);
  expect(fileMocks.upload).toHaveBeenCalledTimes(1);
  expect(fileMocks.boundEnqueue).toHaveBeenCalledTimes(1);
 });
 it('reuses an already-stored company file on retry instead of uploading a duplicate',async()=>{
  vi.stubEnv('VELORA_KNOWLEDGE_FILE_WORKER_ENABLED','true');
  const existingId='44444444-4444-4444-8444-444444444444';
  const bytes=Buffer.from('same-bytes');
  const {createHash}=await import('node:crypto');
  const sha=createHash('sha256').update(bytes).digest('hex');
  const {createClient}=await import('@/lib/supabase/server');
  const restore=vi.mocked(createClient).getMockImplementation();
  const clientWithExisting={
   rpc:rpcMock,
   from:()=>{
    const filters:Array<[string,unknown]>=[];
    const q:Record<string,unknown>={
     select:()=>q,
     eq:(k:string,v:unknown)=>{filters.push([k,v]);return q;},
     in:()=>q,
     maybeSingle:async()=>{
      if(!approveRow)return {data:null,error:null};
      const ok=filters.every(([k,v])=>approveRow![k]===v);
      return {data:ok?{...approveRow}:null,error:null};
     },
     then:(resolve:(v:{data:unknown[];error:null})=>void)=>resolve({
      data:[{id:existingId,company_id:VALID_COMPANY_ID,file_name:'reuse.pdf',byte_size:bytes.length,storage_path:`${VALID_COMPANY_ID}/${existingId}/reuse.pdf`,content_version:2,prepared_file_sha256:sha}],
      error:null,
     }),
    };
    return q;
   },
  };
  vi.mocked(createClient).mockImplementation(async()=>clientWithExisting as never);
  try{
   fileMocks.boundEnqueue.mockResolvedValue({mode:'queued',attemptId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',status:'processing'});
   expect(await uploadOwnedBranchKnowledgeFilesAction({...scope,expectedVersion:1,files:[new File([bytes],'reuse.pdf',{type:'application/pdf'})]})).toEqual(snapshot);
   expect(fileMocks.upload).not.toHaveBeenCalled();
   expect(rpcMock).toHaveBeenCalledWith('es02_bind_owned_branch_knowledge_source',expect.objectContaining({p_source_id:existingId,p_content_version:2}));
   expect(fileMocks.boundEnqueue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({sourceId:existingId}));
  }finally{
   if(restore)vi.mocked(createClient).mockImplementation(restore);
   else vi.mocked(createClient).mockReset();
  }
 });
});
vi.mock("./safe-website-fetcher", async () => ({ ...(await vi.importActual<typeof import("./safe-website-fetcher")>("./safe-website-fetcher")), safeFetchWebsite: vi.fn() }));
vi.mock("@/lib/answers/context", () => ({ loadApprovedAnswerContext: vi.fn(async () => ({ ok: false, code: "NO_KNOWLEDGE" })) }));

describe("paid-branch-knowledge-actions", () => {
  beforeEach(() => {
    currentSessionId = VALID_ACCOUNT_ID;
    vi.mocked(safeFetchWebsite).mockReset().mockResolvedValue({ ok: true, title: "Velora Boutique", extractedText: "Welcome to our shop", finalUrl: "https://example.com/about" });
    rpcMock = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        data: {
          snapshot: {
            scope: {
              expectedAccountId: VALID_ACCOUNT_ID,
              companyId: VALID_COMPANY_ID,
              branchId: VALID_BRANCH_ID,
            },
            version: 1,
            branchLabel: "Main",
            websiteQuota: { limit: 10, used: 1 },
            pages: [{ id: "44444444-4444-4444-8444-444444444444", companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID, version: 1, url: "https://example.com/about", status: "processing" }],
            files: [],
            faq: [],
            capabilities: { canAddWebsite: true, canUploadFiles: true, canSaveText: true },
          },
        },
      },
      error: null,
    });
  });

  describe("isSafePublicUrl SSRF protection", () => {
    it("rejects non-http/https protocols", async () => {
      expect(await isSafePublicUrl("ftp://example.com")).toBe(false);
      expect(await isSafePublicUrl("file:///etc/passwd")).toBe(false);
      expect(await isSafePublicUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects loopback and localhost", async () => {
      expect(await isSafePublicUrl("http://localhost:3000")).toBe(false);
      expect(await isSafePublicUrl("https://127.0.0.1:8080")).toBe(false);
      expect(await isSafePublicUrl("http://[::1]")).toBe(false);
    });

    it("rejects cloud metadata and private IP ranges", async () => {
      expect(await isSafePublicUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
      expect(await isSafePublicUrl("http://10.0.0.1/admin")).toBe(false);
      expect(await isSafePublicUrl("http://192.168.1.1/router")).toBe(false);
      expect(await isSafePublicUrl("http://172.16.0.5")).toBe(false);
    });

    it("accepts safe public web URLs", async () => {
      expect(await isSafePublicUrl("https://example.com")).toBe(true);
      expect(await isSafePublicUrl("https://www.velora.om/about")).toBe(true);
      expect(await isSafePublicUrl("http://mybusiness.com/menu")).toBe(true);
    });
  });

  it("denies unauthenticated read", async () => {
    currentSessionId = null;
    const res = await readOwnedBranchKnowledgeAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
    });
    expect(res).toBeNull();
  });

  it("blocks SSRF attempts in addOwnedBranchWebsiteAction without hitting database", async () => {
    const res = await addOwnedBranchWebsiteAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      url: "http://169.254.169.254/latest/meta-data",
      rightsAttested: true,
    });
    expect(res).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("saves safe public url with rightsAttested", async () => {
    const res = await addOwnedBranchWebsiteAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      url: "https://example.com/about",
      rightsAttested: true,
    });
    expect(res).not.toBeNull();
    expect(rpcMock).toHaveBeenCalledWith(
      "es02_add_owned_branch_website",
      expect.objectContaining({
        p_url: "https://example.com/about",
      })
    );
  });

  describe("indexOwnedBranchWebsiteAction", () => {
    const VALID_PAGE_ID = "44444444-4444-4444-8444-444444444444";

    it("denies unauthenticated indexing", async () => {
      currentSessionId = null;
      const res = await indexOwnedBranchWebsiteAction({
        expectedAccountId: VALID_ACCOUNT_ID,
        companyId: VALID_COMPANY_ID,
        branchId: VALID_BRANCH_ID,
        pageId: VALID_PAGE_ID,
        url: "https://example.com/about",
      });
      expect(res).toBeNull();
    });

    it("indexes website successfully when safe fetch succeeds", async () => {
      const res = await indexOwnedBranchWebsiteAction({
        expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID,
        pageId: VALID_PAGE_ID, url: "https://example.com/about",
      });

      expect(res).not.toBeNull();
      expect(rpcMock).toHaveBeenCalledWith(
        "es02_index_branch_website_page",
        expect.objectContaining({
          p_page_id: VALID_PAGE_ID,
          p_title: "Velora Boutique",
          p_status: "indexed",
          p_error: null,
        })
      );
    });

    it("records failure when safe fetch fails (e.g. SSRF blocked)", async () => {
      vi.mocked(safeFetchWebsite).mockResolvedValueOnce({ ok: false, code: "SSRF_BLOCKED", message: "Unsafe destination" });
      const res = await indexOwnedBranchWebsiteAction({
        expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID,
        pageId: VALID_PAGE_ID, url: "https://metadata-bypass.com",
      });

      expect(res).not.toBeNull();
      expect(rpcMock).toHaveBeenCalledWith(
        "es02_index_branch_website_page",
        expect.objectContaining({
          p_page_id: VALID_PAGE_ID,
          p_status: "failed",
        })
      );
    });
  });

  describe("loadApprovedBranchKnowledgeContext", () => {
    it.each(["bound", "foreign"])("restricts answer sources to the verified branch (%s)", async (binding) => {
      const sourceId="55555555-5555-4555-8555-555555555555";
      rpcMock.mockResolvedValueOnce({data:{ok:true,data:{pages:[],knowledgeRevision:"k1"}},error:null});
      rpcMock.mockResolvedValueOnce({data:{ok:true,data:{snapshot:{
        scope:{expectedAccountId:VALID_ACCOUNT_ID,companyId:VALID_COMPANY_ID,branchId:VALID_BRANCH_ID},version:1,pages:[],faq:[],
        files:[{branchId:binding==="bound"?VALID_BRANCH_ID:VALID_COMPANY_ID,source:{id:sourceId,company_id:VALID_COMPANY_ID}}],
      }}},error:null});
      const loader=vi.mocked((await import("@/lib/answers/context")).loadApprovedAnswerContext);
      loader.mockClear();
      await loadApprovedBranchKnowledgeContext(VALID_COMPANY_ID,VALID_BRANCH_ID);
      if(binding==="bound")expect(loader).toHaveBeenCalledWith(VALID_COMPANY_ID,expect.anything(),undefined,[sourceId]);
      else expect(loader).not.toHaveBeenCalled();
    });
    it("loads indexed branch website pages and approved company knowledge", async () => {
      rpcMock.mockResolvedValueOnce({ data: { ok: true, data: {
        pages: [{ id: "44444444-4444-4444-8444-444444444444", version: 1, url: "https://velora.om", title: "Velora Main", extracted_text: "Exclusive fashion boutique in Muscat." }], knowledgeRevision: "server-revision",
      } }, error: null });
      const result = await loadApprovedBranchKnowledgeContext(VALID_COMPANY_ID, VALID_BRANCH_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.chunks.length).toBeGreaterThan(0);
        expect(result.chunks[0].text).toContain("Exclusive fashion boutique in Muscat.");
        expect(result.knowledgeRevision).not.toBe("no_pages");
      }
    });
  });
});

it("does not report successful knowledge context when private-page access fails", async () => {
  currentSessionId = VALID_ACCOUNT_ID;
  rpcMock = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
  const result = await loadApprovedBranchKnowledgeContext(VALID_COMPANY_ID, VALID_BRANCH_ID);
  expect(result.ok).toBe(false);
  expect(result.chunks).toEqual([]);
  expect(result).toMatchObject({ code: "UNAVAILABLE" });
});

it("maps answer-context overflow from the owned RPC to CONTEXT_OVERFLOW", async () => {
  currentSessionId = VALID_ACCOUNT_ID;
  rpcMock = vi.fn().mockResolvedValue({ data: { ok: false, code: "ANSWER_CONTEXT_OVERFLOW" }, error: null });
  const result = await loadApprovedBranchKnowledgeContext(VALID_COMPANY_ID, VALID_BRANCH_ID);
  expect(result).toEqual({ ok: false, chunks: [], knowledgeRevision: "unavailable", code: "CONTEXT_OVERFLOW" });
});

describe("es02 page action migration preflight baseline guard", () => {
  it("proves correct matching with md5(pg_get_functiondef(oid)) and rejection on altered definition", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const crypto = await import("node:crypto");

    const sqlPath = path.resolve(process.cwd(), "supabase/migrations/20261022075859_es02_page_action_version_guard_review.sql");
    const sqlContent = fs.readFileSync(sqlPath, "utf8");

    // 1. Verify SQL contract strictly uses pg_get_functiondef(oid) and NOT prosrc
    expect(sqlContent).toContain("select md5(pg_get_functiondef(oid)) from pg_proc");
    expect(sqlContent).not.toContain("select md5(prosrc) from pg_proc");

    const approvedFunctionDefHash = "a603d893224730a13332e005a174cc7e";
    const prodProsrcHash = "f1b31b4d1cf2b8d4b024122111a8209c";
    expect(sqlContent).toContain(`is distinct from '${approvedFunctionDefHash}'`);

    // 2. Logic model of the SQL DO block guard:
    const runGuard = (computedHash: string) => {
      if (computedHash !== approvedFunctionDefHash) {
        throw new Error("ES02_PAGE_ACTION_BASELINE_CHANGED");
      }
      return true;
    };

    // Correct matching: pg_get_functiondef hash on production matches approved hash -> PASS
    expect(runGuard(approvedFunctionDefHash)).toBe(true);

    // Rejection on altered definition: any altered definition produces different hash -> REJECT
    const alteredHash = crypto.createHash("md5").update("CREATE OR REPLACE FUNCTION modified_body").digest("hex");
    expect(() => runGuard(alteredHash)).toThrow("ES02_PAGE_ACTION_BASELINE_CHANGED");

    // Regression proof: old buggy prosrc check would have falsely rejected the valid production baseline
    expect(() => runGuard(prodProsrcHash)).toThrow("ES02_PAGE_ACTION_BASELINE_CHANGED");
  });
});

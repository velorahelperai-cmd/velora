"use server";

import { randomUUID } from "node:crypto";
import { readSessionIdentity } from "@/lib/auth/server-identity";
import { withLogContext } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import type {
  BranchKnowledgeViewSnapshot,
  KnowledgeViewScope,
} from "@/components/app/paid-branch-knowledge";
import {
  safeFetchWebsite,
  type SafeFetchOptions,
} from "./safe-website-fetcher";
import type { AnswerContextChunk } from "@/lib/answers/types";
import { loadApprovedAnswerContext } from "@/lib/answers/context";
import { ANSWER_MAX_CONTEXT_CHARS, ANSWER_MAX_SOURCES } from "@/lib/answers/constants";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundKnowledgeSnapshot(data:unknown,scope:KnowledgeViewScope):BranchKnowledgeViewSnapshot|null{
 const value=data as {ok?:boolean;data?:{snapshot?:BranchKnowledgeViewSnapshot}}|null,s=value?.data?.snapshot;
 return value?.ok===true&&s?.scope?.expectedAccountId===scope.expectedAccountId&&s.scope.companyId===scope.companyId&&s.scope.branchId===scope.branchId&&s.version===1&&Array.isArray(s.files)&&Array.isArray(s.faq)&&Array.isArray(s.pages)?s:null;
}

export async function saveOwnedBranchKnowledgeTextAction(input:KnowledgeViewScope&{expectedVersion:number;title:string;content:string}):Promise<BranchKnowledgeViewSnapshot|null>{
 try{
 if(!validScope(input)||input.expectedVersion!==1||typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>200||typeof input.content!=='string'||!input.content.trim()||input.content.trim().length>20000)return null;
 const identity=await readSessionIdentity();if(!identity.ok||identity.userId!==input.expectedAccountId)return null;
 const client=await createClient();const result=await client.rpc('es02_save_owned_branch_knowledge_text' as never,{p_expected_account_id:input.expectedAccountId,p_company_id:input.companyId,p_branch_id:input.branchId,p_expected_version:input.expectedVersion,p_title:input.title.trim(),p_content:input.content.trim()} as never);
 return result.error?null:boundKnowledgeSnapshot(result.data,input);
 }catch{return null;}
}

export async function approveOwnedBranchKnowledgeSourceAction(input:KnowledgeViewScope&{sourceId:string;contentVersion:number;approved:boolean}):Promise<BranchKnowledgeViewSnapshot|null>{
 try{
 if(!validScope(input)||!UUID.test(input.sourceId)||!Number.isSafeInteger(input.contentVersion)||input.contentVersion<1||typeof input.approved!=='boolean')return null;
 const identity=await readSessionIdentity();if(!identity.ok||identity.userId!==input.expectedAccountId)return null;
 const client=await createClient();const result=await client.rpc('es02_approve_owned_branch_knowledge_source' as never,{p_expected_account_id:input.expectedAccountId,p_company_id:input.companyId,p_branch_id:input.branchId,p_source_id:input.sourceId,p_content_version:input.contentVersion,p_approved:input.approved} as never);
 return result.error?null:boundKnowledgeSnapshot(result.data,input);
 }catch{return null;}
}

export async function uploadOwnedBranchKnowledgeFilesAction(input:KnowledgeViewScope&{expectedVersion:number;files:File[]}):Promise<BranchKnowledgeViewSnapshot|null>{
 try{
 if(!validScope(input)||input.expectedVersion!==1||!Array.isArray(input.files)||input.files.length<1||input.files.length>5)return null;
 const identity=await readSessionIdentity();if(!identity.ok||identity.userId!==input.expectedAccountId)return null;
 const snapshot=await readOwnedBranchKnowledgeAction(input);if(!snapshot||snapshot.version!==input.expectedVersion||snapshot.capabilities.canUploadFiles!==true)return null;
 const {getCompanyAccess}=await import('./access');const access=await getCompanyAccess('owner');
 if(!access.ok||access.context.userId!==input.expectedAccountId||access.context.company?.id!==input.companyId)return null;
 const {uploadKnowledgeFiles}=await import('@/lib/knowledge/actions');const form=new FormData();form.set('expectedCompanyId',input.companyId);for(const file of input.files)form.append('files',file);
 const uploaded=await uploadKnowledgeFiles(form);if(!uploaded.ok)return null;
 const client=await createClient();let latest:BranchKnowledgeViewSnapshot|null=null;
 for(const item of uploaded.data){
  const source=item.source;if(!source||source.company_id!==input.companyId||!UUID.test(source.id)||!Number.isSafeInteger(source.content_version)||source.content_version!<1)continue;
  const result=await client.rpc('es02_bind_owned_branch_knowledge_source' as never,{p_expected_account_id:input.expectedAccountId,p_company_id:input.companyId,p_branch_id:input.branchId,p_source_id:source.id,p_content_version:source.content_version} as never);
  if(result.error)return null;latest=boundKnowledgeSnapshot(result.data,input);if(!latest)return null;
 }
 return latest;
 }catch{return null;}
}

function validScope(s: unknown): s is KnowledgeViewScope {
  if (!s || typeof s !== "object") return false;
  const scope = s as Record<string, unknown>;
  return (
    typeof scope.expectedAccountId === "string" &&
    UUID.test(scope.expectedAccountId) &&
    typeof scope.companyId === "string" &&
    UUID.test(scope.companyId) &&
    typeof scope.branchId === "string" &&
    UUID.test(scope.branchId)
  );
}

/**
 * Validates public web URLs and prevents SSRF attacks targeting localhost,
 * cloud metadata endpoints (169.254.169.254), or internal RFC1918 networks.
 */
export async function isSafePublicUrl(rawUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
      return false;
    }
    // Check loopback / private IP patterns
    if (
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.includes(":") ||
      hostname === "169.254.169.254" ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^0\.0\.0\.0$/.test(hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function readOwnedBranchKnowledgeAction(
  scope: KnowledgeViewScope
): Promise<BranchKnowledgeViewSnapshot | null> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: scope?.expectedAccountId }, async () => {
    if (!validScope(scope)) return null;
    const identity = await readSessionIdentity();
    if (!identity.ok || identity.userId !== scope.expectedAccountId) return null;

    const client = await createClient();
    const res = await client.rpc("es02_read_owned_branch_knowledge" as never, {
      p_expected_account_id: scope.expectedAccountId,
      p_company_id: scope.companyId,
      p_branch_id: scope.branchId,
    } as never);

    const payload = res.data as unknown as { ok?: boolean; data?: { snapshot: BranchKnowledgeViewSnapshot } };
    if (res.error || !payload || payload.ok !== true) return null;
    return payload.data?.snapshot ?? null;
  });
}

export async function addOwnedBranchWebsiteAction(
  input: KnowledgeViewScope & { expectedVersion: number; url: string; rightsAttested: true; fetchOptions?: SafeFetchOptions }
): Promise<BranchKnowledgeViewSnapshot | null> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    if (!validScope(input) || !input.url?.trim() || input.rightsAttested !== true) return null;
    // Strict SSRF validation: reject localhost, metadata IP, internal network ranges
    if (!(await isSafePublicUrl(input.url.trim()))) return null;

    const identity = await readSessionIdentity();
    if (!identity.ok || identity.userId !== input.expectedAccountId) return null;

    const client = await createClient();
    const res = await client.rpc("es02_add_owned_branch_website" as never, {
      p_expected_account_id: input.expectedAccountId,
      p_company_id: input.companyId,
      p_branch_id: input.branchId,
      p_expected_version: input.expectedVersion,
      p_url: input.url.trim(),
    } as never);

    const payload = res.data as unknown as { ok?: boolean; data?: { snapshot: BranchKnowledgeViewSnapshot } };
    if (res.error || !payload || payload.ok !== true) return null;
    const saved = payload.data?.snapshot;
    const page = saved?.pages.find(p => p.url === input.url.trim());
    if (!page) return null;
    if (!Number.isSafeInteger(page.version) || (page.version ?? 0) < 1) return null;
    return indexOwnedBranchWebsiteAction({ ...input, pageId: page.id, expectedPageVersion: page.version! });
  });
}

export async function pageActionOwnedBranchKnowledgeAction(
  input: KnowledgeViewScope & { pageId: string; pageVersion: number; action: "retry" | "retrain" }
): Promise<BranchKnowledgeViewSnapshot | null> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    if (!validScope(input) || !input.pageId || !UUID.test(input.pageId) ||
        !Number.isSafeInteger(input.pageVersion) || input.pageVersion < 1 || input.pageVersion >= 2147483647 ||
        !["retry", "retrain"].includes(input.action)) return null;
    const identity = await readSessionIdentity();
    if (!identity.ok || identity.userId !== input.expectedAccountId) return null;

    const client = await createClient();
    const res = await client.rpc("es02_page_action_owned_branch_knowledge" as never, {
      p_expected_account_id: input.expectedAccountId,
      p_company_id: input.companyId,
      p_branch_id: input.branchId,
      p_page_id: input.pageId,
      p_action: input.action,
      p_expected_page_version: input.pageVersion,
    } as never);

    const payload = res.data as unknown as { ok?: boolean; data?: { snapshot: BranchKnowledgeViewSnapshot } };
    if (res.error || !payload || payload.ok !== true) return null;
    const page = payload.data?.snapshot?.pages.find(p => p.id === input.pageId && p.companyId === input.companyId && p.branchId === input.branchId);
    if (!page || page.version !== input.pageVersion + 1) return null;
    return indexOwnedBranchWebsiteAction({ ...input, expectedPageVersion: page.version });
  });
}

export async function indexOwnedBranchWebsiteAction(
  input: KnowledgeViewScope & {
    pageId: string;
    expectedPageVersion?: number;
    // Compatibility fields are ignored: URL and limits come from the server.
    url?: string;
    fetchOptions?: SafeFetchOptions;
  }
): Promise<BranchKnowledgeViewSnapshot | null> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    if (!validScope(input) || !input.pageId || !UUID.test(input.pageId)) {
      return null;
    }
    const identity = await readSessionIdentity();
    if (!identity.ok || identity.userId !== input.expectedAccountId) return null;

    // Resolve ownership AND the persisted URL before opening any socket.
    const snapshot = await readOwnedBranchKnowledgeAction(input);
    const page = snapshot?.pages.find(p => p.id === input.pageId && p.companyId === input.companyId && p.branchId === input.branchId);
    if (!page || !Number.isSafeInteger(page.version)) return null;
    if (input.expectedPageVersion !== undefined && page.version !== input.expectedPageVersion) return null;
    const fetchRes = await safeFetchWebsite(page.url);
    const client = await createClient();

    let rpcRes;
    if (fetchRes.ok) {
      rpcRes = await client.rpc("es02_index_branch_website_page" as never, {
        p_expected_account_id: input.expectedAccountId,
        p_company_id: input.companyId,
        p_branch_id: input.branchId,
        p_page_id: input.pageId,
        p_expected_version: page.version,
        p_expected_url: page.url,
        p_title: fetchRes.title,
        p_extracted_text: fetchRes.extractedText,
        p_status: "indexed",
        p_error: null,
      } as never);
    } else {
      rpcRes = await client.rpc("es02_index_branch_website_page" as never, {
        p_expected_account_id: input.expectedAccountId,
        p_company_id: input.companyId,
        p_branch_id: input.branchId,
        p_page_id: input.pageId,
        p_expected_version: page.version,
        p_expected_url: page.url,
        p_title: null,
        p_extracted_text: null,
        p_status: "failed",
        p_error: `${fetchRes.code}: ${fetchRes.message}`,
      } as never);
    }

    const payload = rpcRes?.data as unknown as { ok?: boolean; data?: { snapshot: BranchKnowledgeViewSnapshot } };
    if (rpcRes?.error || !payload || payload.ok !== true) return null;
    return payload.data?.snapshot ?? null;
  });
}

export interface BranchKnowledgeContextResult {
  ok: boolean;
  chunks: AnswerContextChunk[];
  knowledgeRevision: string;
}

export async function loadApprovedBranchKnowledgeContext(
  companyId: string,
  branchId: string
): Promise<BranchKnowledgeContextResult> {
  const unavailable: BranchKnowledgeContextResult = { ok: false, chunks: [], knowledgeRevision: "unavailable" };
  const identity = await readSessionIdentity();
  if (!identity.ok || !UUID.test(companyId) || !UUID.test(branchId)) return unavailable;
  try {
    const client = await createClient();
    const res = await client.rpc("es02_read_owned_branch_answer_context" as never, {
      p_expected_account_id: identity.userId, p_company_id: companyId, p_branch_id: branchId,
    } as never);
    const result = res.data as unknown as { ok?: boolean; data?: { pages?: Array<{ id: string; version: number; url: string; title: string | null; extracted_text: string }>; knowledgeRevision?: string } };
    if (res.error || result?.ok !== true || !Array.isArray(result.data?.pages) || typeof result.data.knowledgeRevision !== "string") return unavailable;
    const chunks: AnswerContextChunk[] = [];
    for (const page of result.data.pages) {
      if (!UUID.test(page.id) || !Number.isSafeInteger(page.version) || page.version < 1 || typeof page.url !== "string" || typeof page.extracted_text !== "string" || !page.extracted_text.trim()) return unavailable;
      chunks.push({ sourceId: `page-${page.id}`, title: page.title || page.url, contentVersion: page.version, text: page.extracted_text, usageRole: "knowledge" });
    }
    // Reuse canonical approval AND file-object integrity checks for public knowledge.
    const company = await loadApprovedAnswerContext(companyId, client);
    if (!company.ok && company.code !== "NO_KNOWLEDGE") return unavailable;
    if (company.ok) chunks.push(...company.chunks);
    if (!chunks.length || chunks.length > ANSWER_MAX_SOURCES || chunks.reduce((n, c) => n + c.title.length + c.text.length + 6, 0) > ANSWER_MAX_CONTEXT_CHARS) return unavailable;
    return { ok: true, chunks, knowledgeRevision: result.data.knowledgeRevision };
  } catch {
    return unavailable;
  }
}

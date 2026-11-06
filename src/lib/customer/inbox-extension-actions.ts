'use server';

import { createClient } from '@/lib/supabase/server';
import { getCompanyAccess } from '@/lib/tenancy/access';
import { validInboxAttachment } from './inbox-attachment-validation';

type Input = {
  companyId: string;
  conversationId: string;
  channel: 'whatsapp' | 'instagram';
} & (
  | { action: 'list' | 'star' | 'unstar' }
  | { action: 'download' | 'untag' | 'unquick'; itemId: string }
  | { action: 'tag' | 'note' | 'quick'; itemId: string; body: string }
  | { action: 'file'; itemId: string; body: string; mime: string; base64: string }
);

const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function runInboxExtension(input: Input) {
  if (!input || !uuid(input.companyId) || !uuid(input.conversationId) ||
      !['whatsapp', 'instagram'].includes(input.channel) ||
      !['list', 'star', 'unstar', 'download', 'untag', 'tag', 'note', 'file', 'quick', 'unquick'].includes(input.action)) {
    return { ok: false as const, code: 'INVALID_INPUT' };
  }
  if (('itemId' in input && !uuid(input.itemId)) ||
      ('body' in input && (typeof input.body !== 'string' || input.body.length > 2000)) ||
      (input.action === 'quick' && (typeof input.body !== 'string' || input.body.length > 250)) ||
      (input.action === 'file' && !validInboxAttachment(input.body, input.mime, input.base64))) {
    return { ok: false as const, code: 'INVALID_INPUT' };
  }
  const args = {
    p_company_id: input.companyId.toLowerCase(),
    p_conversation_id: input.conversationId.toLowerCase(),
    p_channel: input.channel,
    p_action: input.action,
    p_item_id: 'itemId' in input ? input.itemId : null,
    p_body: 'body' in input ? input.body : null,
    p_mime: input.action === 'file' ? input.mime : null,
    p_base64: input.action === 'file' ? input.base64 : null,
  };
  try {
    const access = await getCompanyAccess();
    if (!access.ok || access.context.company?.id !== args.p_company_id || !access.context.membership) {
      return { ok: false as const, code: 'FORBIDDEN' };
    }
    const client = await createClient() as unknown as {
      rpc(name: string, parameters: typeof args): Promise<{ data: unknown; error: unknown }>;
    };
    const { data, error } = await client.rpc('customer_inbox_extension', args);
    if (error || !data || typeof data !== 'object' || !('ok' in data)) {
      return { ok: false as const, code: 'UNAVAILABLE' };
    }
    if (data.ok === true && 'data' in data) return { ok: true as const, data: data.data };
    if (data.ok === false && 'code' in data && typeof data.code === 'string' &&
        ['FORBIDDEN', 'INVALID_INPUT', 'CONFLICT', 'LIMIT', 'UNAVAILABLE'].includes(data.code)) {
      return { ok: false as const, code: data.code };
    }
    return { ok: false as const, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false as const, code: 'UNAVAILABLE' };
  }
}

/** Read only the current user's stars for a bounded page of authorized threads. */
export async function listInboxStars(input: { companyId: string; channel: 'whatsapp' | 'instagram'; conversationIds: string[] }) {
  if (!input || !uuid(input.companyId) || !['whatsapp', 'instagram'].includes(input.channel) ||
      !Array.isArray(input.conversationIds) || input.conversationIds.length < 1 || input.conversationIds.length > 40 ||
      !input.conversationIds.every(uuid)) return { ok: false as const, code: 'INVALID_INPUT' };
  const company = input.companyId.toLowerCase();
  const channel = input.channel;
  const ids = [...new Set(input.conversationIds.map(id => id.toLowerCase()))];
  try {
    const access = await getCompanyAccess();
    if (!access.ok || access.context.company?.id !== company || !access.context.membership) return { ok: false as const, code: 'FORBIDDEN' };
    const client = await createClient() as unknown as {
      rpc(name: string, args: { p_company_id: string; p_channel: string; p_conversation_ids: string[] }): Promise<{ data: unknown; error: unknown }>;
    };
    const { data, error } = await client.rpc('customer_inbox_star_batch', { p_company_id: company, p_channel: channel, p_conversation_ids: ids });
    if (error || !data || typeof data !== 'object' || !('ok' in data)) return { ok: false as const, code: 'UNAVAILABLE' };
    if (data.ok === false && 'code' in data && data.code === 'FORBIDDEN') return { ok: false as const, code: 'FORBIDDEN' };
    if (data.ok !== true || !('data' in data) || !Array.isArray(data.data) ||
        !data.data.every((id: unknown) => uuid(id) && ids.includes(id.toLowerCase()))) return { ok: false as const, code: 'UNAVAILABLE' };
    return { ok: true as const, data: [...new Set(data.data.map((id: string) => id.toLowerCase()))] };
  } catch { return { ok: false as const, code: 'UNAVAILABLE' }; }
}

export async function listWhatsappMediaMetadata(input: { companyId: string; conversationId: string; messageIds: string[] }) {
  if (!input || !uuid(input.companyId) || !uuid(input.conversationId) || !Array.isArray(input.messageIds) ||
      input.messageIds.length < 1 || input.messageIds.length > 40 || !input.messageIds.every(uuid)) {
    return { ok: false as const, code: 'INVALID_INPUT' };
  }
  const companyId=input.companyId.toLowerCase(),conversationId=input.conversationId.toLowerCase();
  const ids=[...new Set(input.messageIds.map(id=>id.toLowerCase()))];
  try {
    const access=await getCompanyAccess();
    if(!access.ok || access.context.company?.id!==companyId || !access.context.membership) return {ok:false as const,code:'FORBIDDEN'};
    const client=await createClient() as unknown as {rpc(name:string,args:{p_company_id:string;p_conversation_id:string;p_message_ids:string[]}):Promise<{data:unknown;error:unknown}>};
    const {data,error}=await client.rpc('whatsapp_media_message_metadata',{p_company_id:companyId,p_conversation_id:conversationId,p_message_ids:ids});
    if(error || !data || typeof data!=='object' || !('ok' in data))return {ok:false as const,code:'UNAVAILABLE'};
    if(data.ok===false && 'code' in data && data.code==='forbidden')return {ok:false as const,code:'FORBIDDEN'};
    if(data.ok!==true || !('data' in data) || !Array.isArray(data.data))return {ok:false as const,code:'UNAVAILABLE'};
    const result: {messageId:string;attachmentId:string;filename:string;mime:string;caption:string}[]=[];
    const seen=new Set<string>();
    for(const row of data.data){
      if(!row || typeof row!=='object' || !uuid(row.messageId) || !ids.includes(row.messageId.toLowerCase()) || seen.has(row.messageId.toLowerCase()) ||
         !uuid(row.attachmentId) || typeof row.filename!=='string' || row.filename.length<1 || row.filename.length>100 ||
         !['image/png','image/jpeg','application/pdf'].includes(row.mime) || typeof row.caption!=='string' || row.caption.length>1024)
        return {ok:false as const,code:'UNAVAILABLE'};
      seen.add(row.messageId.toLowerCase());
      result.push({messageId:row.messageId.toLowerCase(),attachmentId:row.attachmentId.toLowerCase(),filename:row.filename,mime:row.mime,caption:row.caption});
    }
    return {ok:true as const,data:result};
  } catch {return {ok:false as const,code:'UNAVAILABLE'};}
}

export async function removeUnboundWhatsappFile(input: {companyId:string;conversationId:string;fileId:string}) {
  if(!input||!uuid(input.companyId)||!uuid(input.conversationId)||!uuid(input.fileId))return {ok:false as const,code:'INVALID_INPUT'};
  const companyId=input.companyId.toLowerCase();
  try{
    const access=await getCompanyAccess();
    if(!access.ok||access.context.company?.id!==companyId||!access.context.membership)return {ok:false as const,code:'FORBIDDEN'};
    const client=await createClient() as unknown as {rpc(name:string,args:{p_company_id:string;p_conversation_id:string;p_file_id:string}):Promise<{data:unknown;error:unknown}>};
    const {data,error}=await client.rpc('customer_inbox_remove_unbound_file',{p_company_id:companyId,p_conversation_id:input.conversationId.toLowerCase(),p_file_id:input.fileId.toLowerCase()});
    if(error||!data||typeof data!=='object'||!('ok' in data))return {ok:false as const,code:'UNAVAILABLE'};
    if(data.ok===true)return {ok:true as const};
    if(data.ok===false&&'code' in data&&data.code==='in_use')return {ok:false as const,code:'IN_USE'};
    if(data.ok===false&&'code' in data&&data.code==='forbidden')return {ok:false as const,code:'FORBIDDEN'};
    return {ok:false as const,code:'UNAVAILABLE'};
  }catch{return {ok:false as const,code:'UNAVAILABLE'};}
}

const contactEmail = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
export function validInboxContact(email: string, location: string) {
  const mail = email.trim();
  const place = location.trim();
  if (mail.length > 254 || place.length > 120 || mail.includes('\0') || place.includes('\0')) return false;
  return mail === '' || contactEmail.test(mail);
}

type ContactProfile = { email: string; location: string };
function contactProfile(value: unknown): ContactProfile | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { email?: unknown; location?: unknown };
  if (typeof row.email !== 'string' || typeof row.location !== 'string') return null;
  if (!validInboxContact(row.email, row.location)) return null;
  return { email: row.email.trim(), location: row.location.trim() };
}

export async function readInboxContact(input: { companyId: string; conversationId: string; channel: 'whatsapp' | 'instagram' }) {
  if (!input || !uuid(input.companyId) || !uuid(input.conversationId) || !['whatsapp', 'instagram'].includes(input.channel)) {
    return { ok: false as const, code: 'INVALID_INPUT' };
  }
  const args = {
    p_company_id: input.companyId.toLowerCase(),
    p_conversation_id: input.conversationId.toLowerCase(),
    p_channel: input.channel,
    p_action: 'read',
    p_email: null,
    p_location: null,
  };
  try {
    const access = await getCompanyAccess();
    if (!access.ok || access.context.company?.id !== args.p_company_id || !access.context.membership) {
      return { ok: false as const, code: 'FORBIDDEN' };
    }
    const client = await createClient() as unknown as {
      rpc(name: string, parameters: typeof args): Promise<{ data: unknown; error: unknown }>;
    };
    const { data, error } = await client.rpc('customer_inbox_contact', args);
    if (error || !data || typeof data !== 'object' || !('ok' in data)) return { ok: false as const, code: 'UNAVAILABLE' };
    if (data.ok === true && 'data' in data) {
      const profile = contactProfile(data.data);
      if (!profile) return { ok: false as const, code: 'UNAVAILABLE' };
      return { ok: true as const, data: profile };
    }
    if (data.ok === false && 'code' in data && typeof data.code === 'string' &&
        ['FORBIDDEN', 'INVALID_INPUT', 'UNAVAILABLE'].includes(data.code)) {
      return { ok: false as const, code: data.code as 'FORBIDDEN' | 'INVALID_INPUT' | 'UNAVAILABLE' };
    }
    return { ok: false as const, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false as const, code: 'UNAVAILABLE' };
  }
}

export async function saveInboxContact(input: { companyId: string; conversationId: string; channel: 'whatsapp' | 'instagram'; email: string; location: string }) {
  if (!input || !uuid(input.companyId) || !uuid(input.conversationId) || !['whatsapp', 'instagram'].includes(input.channel) ||
      typeof input.email !== 'string' || typeof input.location !== 'string' || !validInboxContact(input.email, input.location)) {
    return { ok: false as const, code: 'INVALID_INPUT' };
  }
  const args = {
    p_company_id: input.companyId.toLowerCase(),
    p_conversation_id: input.conversationId.toLowerCase(),
    p_channel: input.channel,
    p_action: 'save',
    p_email: input.email.trim(),
    p_location: input.location.trim(),
  };
  try {
    const access = await getCompanyAccess();
    if (!access.ok || access.context.company?.id !== args.p_company_id || !access.context.membership) {
      return { ok: false as const, code: 'FORBIDDEN' };
    }
    const client = await createClient() as unknown as {
      rpc(name: string, parameters: typeof args): Promise<{ data: unknown; error: unknown }>;
    };
    const { data, error } = await client.rpc('customer_inbox_contact', args);
    if (error || !data || typeof data !== 'object' || !('ok' in data)) return { ok: false as const, code: 'UNAVAILABLE' };
    if (data.ok === true && 'data' in data) {
      const profile = contactProfile(data.data);
      if (!profile || profile.email !== args.p_email || profile.location !== args.p_location) return { ok: false as const, code: 'UNAVAILABLE' };
      return { ok: true as const, data: profile };
    }
    if (data.ok === false && 'code' in data && typeof data.code === 'string' &&
        ['FORBIDDEN', 'INVALID_INPUT', 'UNAVAILABLE'].includes(data.code)) {
      return { ok: false as const, code: data.code as 'FORBIDDEN' | 'INVALID_INPUT' | 'UNAVAILABLE' };
    }
    return { ok: false as const, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false as const, code: 'UNAVAILABLE' };
  }
}

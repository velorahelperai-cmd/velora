import {loadWhatsappThreadPage} from '@/lib/whatsapp/inbox-contracts';
import {runWithVerifiedReadClient} from '@/lib/supabase/server';
import {runWithVerifiedCompanyRead} from '@/lib/tenancy/access';
import {readInboxCapability} from '@/lib/access/inbox-capability';
import {readSessionConversationScope} from '@/lib/access/conversation-scope';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Same native thread/RLS reader, independently transported under final fences. */
export async function GET(request:Request){
 const url=new URL(request.url),q=url.searchParams;
 const companyId=q.get('companyId')??'',conversationId=q.get('conversationId')??'',before=q.get('before'),limit=q.has('limit')?Number(q.get('limit')):undefined;
 const fail=(code:string,status=200)=>Response.json({ok:false,code},{status,headers});
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return fail('FORBIDDEN',403);
 if(!uuid.test(companyId)||!uuid.test(conversationId)||[...q.keys()].some(k=>!['companyId','conversationId','before','limit'].includes(k)||q.getAll(k).length!==1)
  ||before!==null&&!/^[1-9][0-9]{0,18}$/.test(before)||limit!==undefined&&(!Number.isInteger(limit)||limit<1||limit>100))return fail('INVALID_INPUT',400);
 try{
  const {value}=await runWithVerifiedReadClient(()=>runWithVerifiedCompanyRead(async()=>{
   const initial=await readSessionConversationScope(companyId);
   if(!initial.ok)return initial;
   const result=await loadWhatsappThreadPage({companyId,conversationId,before,limit});
   if(!result.ok)return result;
   // Assignment can change without the company or scope changing. Re-read
   // using native RLS for assigned-only users before the final authority fence.
   const final=initial.scope==='assigned_only'?await loadWhatsappThreadPage({companyId,conversationId,before,limit}):result;
   if(!final.ok)return final;
   const [scope,cap]=await Promise.all([readSessionConversationScope(companyId),readInboxCapability(companyId,'wa.conversations.read')]);
   if(!scope.ok)return scope;
   if(!cap.ok)return cap;
   if(!cap.allowed)return {ok:false as const,code:'FORBIDDEN' as const};
   if(scope.scope!==initial.scope||final.data.companyId!==companyId||final.data.conversationId!==conversationId)return {ok:false as const,code:'SCOPE_CHANGED' as const};
   return final;
  }));
  return Response.json(value,{headers});
 }catch{return fail('UNAVAILABLE',503);}
}

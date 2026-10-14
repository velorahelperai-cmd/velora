import {timingSafeEqual} from 'node:crypto';
import {runSubscriptionLifecycle} from '@/lib/billing/lifecycle-runtime';
export const runtime='nodejs';
export async function POST(request:Request){
 const token=process.env.SUBSCRIPTION_LIFECYCLE_WORKER_TOKEN?.trim()??'';
 if(token.length<32)return Response.json({code:'LIFECYCLE_NOT_CONFIGURED'},{status:503});
 const expected=Buffer.from(`Bearer ${token}`),actual=Buffer.from(request.headers.get('authorization')??'');
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return Response.json({code:'UNAUTHORIZED'},{status:401});
 const result=await runSubscriptionLifecycle(process.env.SUBSCRIPTION_LIFECYCLE_WORKER_ENABLED==='true');return Response.json(result,{status:result.ok?200:503});
}

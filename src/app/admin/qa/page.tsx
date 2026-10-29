import {notFound} from 'next/navigation';
import {requirePlatformOwner} from '@/lib/tenancy/access';
import {QaBusinessReset} from '@/components/admin/qa-business-reset';
import {createClient} from '@/lib/supabase/server';
export const dynamic='force-dynamic';
export default async function Page(){
 const owner=await requirePlatformOwner();if(!owner.ok)notFound();
 const client=await createClient();const {data,error}=await client.rpc('es02_admin_list_qa_setup' as never);
 const result=data as {ok?:boolean;grants?:Array<{companyId:string;name:string;persona:string;package:string;term:string}>}|null;
 if(error||!result?.ok)return <p role="alert">تعذر قراءة تجارب QA. لم يتغير أي سجل.</p>;
 return <QaBusinessReset grants={result.grants??[]}/>;
}
